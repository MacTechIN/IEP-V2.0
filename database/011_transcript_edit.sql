-- ===================================================================
-- 011: 녹취 직접 수정 · 형광펜 · 부분 재요약
--
-- 왜 필요한가
--   전사는 틀린다. 실측 일치도가 64~70% 수준이고(docs/2026-08-12-stt-engine-benchmark.md),
--   고유명사와 숫자에서 특히 약하다. 그런데 지금은 틀린 것을 보고도 고칠 방법이 없다.
--   고칠 수 있게 되면, 고친 녹취로 요약을 다시 만들 수 있어야 한다.
--
-- 무엇을 남기나
--   1. AI 가 처음 뽑은 원문 — 잘못 고쳤을 때 되돌릴 곳이 없으면 고치기가 무섭다
--   2. 형광펜 범위 — 나중에 다시 볼 때 어디가 중요했는지
--   3. 수정 시각과 재요약 시각 — 둘을 비교해 "요약이 낡았다" 를 판정한다
--
--   **낡음 플래그를 따로 두지 않는 이유**: 플래그는 갱신을 잊으면 어긋난다.
--   두 시각을 비교하면 어긋날 수가 없다 — 사실에서 파생되기 때문이다.
-- ===================================================================

alter table v2.transcript_segments
  -- AI 가 처음 뽑은 원문. **처음 수정할 때만 채운다.**
  -- 두 번째 수정에서 덮으면 "직전 내 수정본" 이 되어 되돌리기가 무의미해진다.
  add column if not exists content_original text,
  add column if not exists edited_at  timestamp with time zone,
  add column if not exists edited_by  uuid references v2.users(id) on delete set null,
  -- [{"start":12,"end":30}] — content 기준 문자 오프셋.
  -- 저장은 문자 단위지만 **칠할 때 어절 경계로 넓힌다**(화면 쪽 처리).
  add column if not exists highlights jsonb not null default '[]'::jsonb;

comment on column v2.transcript_segments.content_original is
  'AI 전사 원문. 처음 수정할 때 한 번만 채운다 — 되돌리기의 기준점이라 덮으면 안 된다.';
comment on column v2.transcript_segments.highlights is
  '형광펜 범위 [{start,end}]. content 문자 오프셋 기준. 그 줄을 수정하면 비운다 — 위치를 추적하려 들면 반드시 틀어진다.';

alter table v2.meetings
  add column if not exists transcript_edited_at timestamp with time zone,
  add column if not exists note_generated_at    timestamp with time zone;

comment on column v2.meetings.transcript_edited_at is
  '녹취를 마지막으로 고친 시각. note_generated_at 보다 나중이면 요약이 낡은 것이다.';

/**
 * 요약이 낡았는가.
 *
 * **`transcript_edited_at > note_generated_at` 만으로는 안 된다.**
 * 새로 만든 미팅은 note_generated_at 이 비어 있고, NULL 과의 비교는 참도 거짓도 아니라
 * 그 미팅은 낡음 판정에서 통째로 빠진다 — 고쳐도 갱신 배너가 안 뜬다.
 * (회귀 테스트 T5 가 이걸 잡았다)
 *
 * 판정을 함수 하나로 묶는 이유: 화면·API·배치가 각자 조건을 쓰면 반드시 어긋난다.
 */
create or replace function v2.note_is_stale(
  p_edited timestamp with time zone,
  p_noted  timestamp with time zone
) returns boolean
language sql immutable as $$
  select p_edited is not null and (p_noted is null or p_edited > p_noted)
$$;

comment on function v2.note_is_stale is
  '녹취 수정 시각과 재요약 시각으로 "요약이 낡았는가" 를 판정한다. 요약을 만든 적이 없으면 낡은 것으로 본다.';

-- 이미 있는 미팅은 "요약이 방금 만들어졌다" 로 둔다.
-- 안 그러면 전부 낡은 것으로 잡혀 갱신 배너가 일제히 뜬다.
update v2.meetings m
   set note_generated_at = coalesce(a.updated_at, m.updated_at, now())
  from v2.analysis_results a
 where a.meeting_id = m.id and m.note_generated_at is null;

update v2.meetings
   set note_generated_at = coalesce(updated_at, now())
 where note_generated_at is null;

-- 낡은 요약을 가진 미팅을 찾는 인덱스. 대부분은 낡지 않았으므로 부분 인덱스로 둔다.
create index if not exists idx_meetings_note_stale
  on v2.meetings (transcript_edited_at)
  where transcript_edited_at is not null;

-- 수정된 세그먼트만 빠르게 찾는다 (수정 지점 순회에 쓴다)
create index if not exists idx_transcript_segments_edited
  on v2.transcript_segments (meeting_id, sort_order)
  where edited_at is not null;
