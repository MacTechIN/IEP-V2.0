-- 011 검증 — 녹취 수정이 무엇을 지키고 무엇을 바꾸는가
--
-- 확인하는 것
--   1. 첫 수정에서 원문이 보관된다
--   2. **두 번째 수정에서 원문이 덮이지 않는다** — 이게 깨지면 되돌리기가 무의미해진다
--   3. 되돌리면 원문으로 돌아가고 수정 표시가 사라진다
--   4. 수정하면 그 줄의 형광펜이 비워진다 (오프셋이 어긋나므로)
--   5. 낡음 판정이 두 시각 비교로 성립한다
--   6. 기존 행 보정으로 갱신 배너가 일제히 뜨지 않는다
--
-- 실행: psql -f database/tests/011_transcript_edit.sql

\set ON_ERROR_STOP on

insert into v2.users (id, email, password_hash, name, role)
values ('11111111-2222-3333-4444-555555555555', 'edit@t.test', 'x', '수정', 'sales_rep')
on conflict (id) do nothing;

-- 수정 함수. Worker 의 PATCH 핸들러와 **같은 규칙**이다.
create or replace function pg_temp.edit_seg(p_id uuid, p_text text, p_user uuid)
returns void language plpgsql as $$
begin
  update v2.transcript_segments
     set content_original = coalesce(content_original, content),  -- ★ 이미 있으면 안 덮는다
         content    = p_text,
         highlights = '[]'::jsonb,                                -- ★ 오프셋이 어긋난다
         edited_at  = now(),
         edited_by  = p_user
   where id = p_id;

  update v2.meetings m
     set transcript_edited_at = now()
    from v2.transcript_segments s
   where s.id = p_id and m.id = s.meeting_id;
end $$;

create or replace function pg_temp.revert_seg(p_id uuid)
returns void language plpgsql as $$
begin
  update v2.transcript_segments
     set content = coalesce(content_original, content),
         content_original = null, edited_at = null, edited_by = null
   where id = p_id;
end $$;

do $$
declare usr uuid := '11111111-2222-3333-4444-555555555555'; mtg uuid; seg uuid; cus uuid;
begin
  insert into v2.customers (user_id, company_name)
  values (usr, '수정 검증 고객') returning id into cus;

  insert into v2.meetings (user_id, customer_id, title, start_time, end_time)
  values (usr, cus, '수정 검증 미팅', now(), now()) returning id into mtg;

  insert into v2.transcript_segments (meeting_id, speaker_label, content, start_ms, end_ms, sort_order)
  values (mtg, '고객', 'AI 가 처음 뽑은 문장 F16', 0, 5000, 0) returning id into seg;

  update v2.transcript_segments
     set highlights = '[{"start":0,"end":5}]'::jsonb where id = seg;

  raise notice 'SETUP seg=%', seg;
end $$;

-- ── 1. 첫 수정
select 'T1_BEFORE' as k, content as v from v2.transcript_segments where speaker_label = '고객';

select pg_temp.edit_seg(
  (select id from v2.transcript_segments where speaker_label = '고객'),
  '사람이 고친 문장 F-16', '11111111-2222-3333-4444-555555555555');

select 'T1_CONTENT'  as k, content as v from v2.transcript_segments where speaker_label = '고객';
select 'T1_ORIGINAL' as k, content_original as v from v2.transcript_segments where speaker_label = '고객';
select 'T1_EDITED'   as k, (edited_at is not null)::text as v from v2.transcript_segments where speaker_label = '고객';

-- ── 4. 형광펜이 비워졌는가
select 'T4_HIGHLIGHTS_CLEARED' as k, highlights::text as v
  from v2.transcript_segments where speaker_label = '고객';

-- ── 2. 두 번째 수정 — 원문이 그대로여야 한다
select pg_temp.edit_seg(
  (select id from v2.transcript_segments where speaker_label = '고객'),
  '두 번째로 고친 문장', '11111111-2222-3333-4444-555555555555');

select 'T2_CONTENT'  as k, content as v from v2.transcript_segments where speaker_label = '고객';
select 'T2_ORIGINAL_UNCHANGED' as k,
       (content_original = 'AI 가 처음 뽑은 문장 F16')::text as v
  from v2.transcript_segments where speaker_label = '고객';

-- ── 5. 낡음 판정 (수정 시각 > 재요약 시각)
--    요약을 만든 적이 없는(note_generated_at is null) 미팅도 낡은 것으로 잡혀야 한다.
--    단순 비교(>)로는 NULL 이 되어 조용히 빠진다 — 그래서 함수로 묶었다.
select 'T5_NAIVE_COMPARE' as k,
       coalesce((transcript_edited_at > note_generated_at)::text, 'NULL ← 이래서 안 된다') as v
  from v2.meetings where title = '수정 검증 미팅';
select 'T5_NOTE_STALE' as k,
       v2.note_is_stale(transcript_edited_at, note_generated_at)::text as v
  from v2.meetings where title = '수정 검증 미팅';

--    재요약했다고 표시하면 낡음이 풀린다
update v2.meetings set note_generated_at = now() where title = '수정 검증 미팅';
select 'T5_AFTER_RENOTE' as k,
       v2.note_is_stale(transcript_edited_at, note_generated_at)::text as v
  from v2.meetings where title = '수정 검증 미팅';

-- ── 3. 되돌리기
select pg_temp.revert_seg((select id from v2.transcript_segments where speaker_label = '고객'));
select 'T3_REVERTED'      as k, content as v from v2.transcript_segments where speaker_label = '고객';
select 'T3_EDIT_CLEARED'  as k, (edited_at is null)::text as v
  from v2.transcript_segments where speaker_label = '고객';

-- ── 6. 고친 적 없는 미팅은 낡지 않았다 (배너가 일제히 뜨면 안 된다)
select 'T6_UNEDITED_NOT_STALE' as k,
       count(*) filter (where v2.note_is_stale(transcript_edited_at, note_generated_at))::text as v
  from v2.meetings where transcript_edited_at is null;

delete from v2.transcript_segments where meeting_id in
  (select id from v2.meetings where title = '수정 검증 미팅');
delete from v2.meetings where title = '수정 검증 미팅';
delete from v2.customers where company_name = '수정 검증 고객';
delete from v2.users where id = '11111111-2222-3333-4444-555555555555';
