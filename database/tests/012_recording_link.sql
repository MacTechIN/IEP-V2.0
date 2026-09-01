-- 012 검증 — 녹취 줄과 녹음의 연결
--
-- 확인하는 것
--   1. 세그먼트가 녹음을 가리킬 수 있다
--   2. **녹음을 지워도 전사는 남는다** (set null) — 전사문이 분석의 근거다
--   3. 옛 행(recording_id 없음)이 섞여 있어도 조회가 깨지지 않는다
--   4. 같은 미팅의 녹음별로 줄을 나눠 셀 수 있다 (재생기가 하는 일)
--   5. **시각이 파일마다 0으로 돌아가는 것**을 recording_id 로 구분할 수 있다
--
-- 실행: psql -f database/tests/012_recording_link.sql

\set ON_ERROR_STOP on

insert into v2.users (id, email, password_hash, name, role)
values ('aaaa1111-bbbb-2222-cccc-333344445555', 'audio@t.test', 'x', '재생', 'sales_rep')
on conflict (id) do nothing;

do $$
declare usr uuid := 'aaaa1111-bbbb-2222-cccc-333344445555';
        cus uuid; mtg uuid; rec1 uuid; rec2 uuid;
begin
  insert into v2.customers (user_id, company_name) values (usr, '재생 검증 고객')
  returning id into cus;
  insert into v2.meetings (user_id, customer_id, title, start_time, end_time)
  values (usr, cus, '재생 검증 미팅', now(), now()) returning id into mtg;

  insert into v2.meeting_recordings (user_id, meeting_id, label, storage_path, transcribe_status)
  values (usr, mtg, '파트 1/2', 'recordings/p1.webm', 'done') returning id into rec1;
  insert into v2.meeting_recordings (user_id, meeting_id, label, storage_path, transcribe_status)
  values (usr, mtg, '파트 2/2', 'recordings/p2.webm', 'done') returning id into rec2;

  -- 파트 1 의 줄들 — 0초부터 시작
  insert into v2.transcript_segments (meeting_id, recording_id, speaker_label, content, start_ms, end_ms, sort_order)
  values (mtg, rec1, '고객', '첫 번째 녹음의 첫 줄', 0, 5000, 0),
         (mtg, rec1, '영업대표', '첫 번째 녹음의 끝 줄', 600000, 605000, 1);

  -- 파트 2 의 줄들 — **다시 0초부터.** 이것이 이 마이그레이션이 필요한 이유다
  insert into v2.transcript_segments (meeting_id, recording_id, speaker_label, content, start_ms, end_ms, sort_order)
  values (mtg, rec2, '고객', '두 번째 녹음의 첫 줄', 0, 4000, 2),
         (mtg, rec2, '영업대표', '두 번째 녹음의 끝 줄', 580000, 585000, 3);

  -- 옛 데이터 흉내 — recording_id 가 없는 줄
  insert into v2.transcript_segments (meeting_id, speaker_label, content, start_ms, end_ms, sort_order)
  values (mtg, '고객', '옛 데이터 (출처 모름)', 1000, 2000, 4);

  raise notice 'SETUP mtg=% rec1=% rec2=%', mtg, rec1, rec2;
end $$;

-- ── 1. 연결이 됐는가
select 'T1_LINKED' as k, count(*)::text as v
  from v2.transcript_segments s
  join v2.meetings m on m.id = s.meeting_id
 where m.title = '재생 검증 미팅' and s.recording_id is not null;

select 'T1_UNLINKED' as k, count(*)::text as v
  from v2.transcript_segments s
  join v2.meetings m on m.id = s.meeting_id
 where m.title = '재생 검증 미팅' and s.recording_id is null;

-- ── 5. 시각이 0으로 돌아가는 것을 구분할 수 있는가
--    recording_id 없이 보면 0초짜리 줄이 둘이라 어느 파일인지 알 수 없다.
select 'T5_ZERO_STARTS' as k, count(*)::text as v
  from v2.transcript_segments s
  join v2.meetings m on m.id = s.meeting_id
 where m.title = '재생 검증 미팅' and s.start_ms = 0;

--    recording_id 로 나누면 각각 어느 파일의 0초인지 분명해진다.
select 'T5_BY_RECORDING' as k,
       string_agg(r.label || '=' || cnt::text, ' · ' order by r.label) as v
  from (select s.recording_id, count(*) as cnt
          from v2.transcript_segments s
          join v2.meetings m on m.id = s.meeting_id
         where m.title = '재생 검증 미팅' and s.recording_id is not null
         group by s.recording_id) x
  join v2.meeting_recordings r on r.id = x.recording_id;

-- ── 4. 재생기가 쓰는 조회 — 한 녹음의 줄만
select 'T4_ONE_RECORDING' as k, count(*)::text as v
  from v2.transcript_segments s
 where s.recording_id = (select id from v2.meeting_recordings where label = '파트 1/2');

-- ── 3. 섞여 있어도 전체 조회가 되는가
select 'T3_ALL_SEGMENTS' as k, count(*)::text as v
  from v2.transcript_segments s
  join v2.meetings m on m.id = s.meeting_id
 where m.title = '재생 검증 미팅';

-- ── 2. 녹음을 지워도 전사는 남는가 ★
delete from v2.meeting_recordings where label = '파트 1/2';

select 'T2_SEGMENTS_SURVIVE' as k, count(*)::text as v
  from v2.transcript_segments s
  join v2.meetings m on m.id = s.meeting_id
 where m.title = '재생 검증 미팅';

select 'T2_LINK_NULLED' as k, count(*)::text as v
  from v2.transcript_segments s
  join v2.meetings m on m.id = s.meeting_id
 where m.title = '재생 검증 미팅' and s.recording_id is null;

--    남은 녹음의 연결은 그대로여야 한다
select 'T2_OTHER_INTACT' as k, count(*)::text as v
  from v2.transcript_segments s
 where s.recording_id = (select id from v2.meeting_recordings where label = '파트 2/2');

delete from v2.transcript_segments where meeting_id in
  (select id from v2.meetings where title = '재생 검증 미팅');
delete from v2.meeting_recordings where meeting_id in
  (select id from v2.meetings where title = '재생 검증 미팅');
delete from v2.meetings where title = '재생 검증 미팅';
delete from v2.customers where company_name = '재생 검증 고객';
delete from v2.users where id = 'aaaa1111-bbbb-2222-cccc-333344445555';
