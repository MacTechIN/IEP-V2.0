-- 030: 분석 결과의 이전 판을 남긴다
--
-- ── 왜 필요한가 ──────────────────────────────────────────────
--
-- 2026-08-27 에 `recordingIds` 없이 재분석을 걸어 **멀쩡한 분석이 사라졌다.**
-- 전사 원문이 남아 있어 다시 돌릴 수 있었지만, 원문까지 지우는 경로였다면
-- 되돌릴 방법이 없었다.
--
-- `2.26.0` 이 쓰기 직전 게이트를 넣었다. 게이트는 「이건 결과가 아니다」 인 것을 막는다.
-- 그런데 **게이트를 아무리 잘 짜도 새는 것이 있다** — 오늘 다섯 건 중 셋은
-- 사람이 화면을 보고 알려 줘서 알았다. 그물이 하나 더 있어야 한다.
--
-- ── 무엇을 남기는가 ──────────────────────────────────────────
--
-- 덮이기 **직전의** `analysis_results` 한 행을 통째로 담는다.
-- 열을 골라 담지 않는다 — 나중에 열이 늘면 그때부터 안 담기고, 그 사실을 아무도 모른다.
--
-- ── 왜 자동 복구를 안 만드는가 ───────────────────────────────
--
-- **되돌리는 것은 사람이 고른다.** 「나빠 보이면 되돌린다」 를 코드가 정하면,
-- 진짜로 달라진 결과(더 나은 분석)까지 되돌린다.
-- `storage_orphans` 와 같은 규칙이다 — 목록을 보여 주고 사람이 정한다.

begin;

create table if not exists v2.analysis_history (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references v2.meetings(id) on delete cascade,
  -- 덮이기 직전의 `analysis_results` 행 전체. 열이 늘어도 그대로 담긴다.
  result jsonb not null,
  -- 그때의 녹취 줄 수. 「1027줄이 3줄이 됐다」 를 이 값으로 안다.
  segment_count integer,
  -- 무엇이 덮었나. 지금은 워크플로뿐이지만, 나중에 손으로 고치는 길이 생기면 갈린다.
  replaced_by text not null default 'analysis-workflow',
  replaced_at timestamptz not null default now()
);

-- 「이 미팅의 최근 판」 이 유일한 질의다.
create index if not exists idx_analysis_history_meeting
  on v2.analysis_history (meeting_id, replaced_at desc);

/**
 * 미팅당 최근 몇 개만 남긴다.
 *
 * **자동으로 지우는 청소기가 아니다** — 새 판을 넣을 때 그 미팅 것만 정리한다.
 * 전체를 훑는 배치를 만들지 않는 이유는, 그런 것이 한번 어긋나면
 * **무엇이 지워졌는지 알 방법이 없기** 때문이다.
 */
create or replace function v2.keep_analysis_history(p_meeting uuid, p_keep integer default 5)
returns integer language plpgsql as $$
declare
  n integer;
begin
  delete from v2.analysis_history
   where meeting_id = p_meeting
     and id not in (
       select id from v2.analysis_history
        where meeting_id = p_meeting
        order by replaced_at desc
        limit greatest(1, p_keep)
     );
  get diagnostics n = row_count;
  return n;
end $$;

comment on table v2.analysis_history is
  '분석 결과가 덮이기 직전의 판. 되돌리는 것은 사람이 고른다 (030)';

commit;
