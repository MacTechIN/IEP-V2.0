-- 010 검증 — 전사 상태 기계
--
-- 확인하는 것
--   1. 새 녹음은 'pending' 으로 들어간다
--   2. 잠금은 **한 번만** 잡힌다 (동시에 둘이 집으면 STT 비용을 두 번 낸다)
--   3. 실패하면 다시 집을 수 있다
--   4. 시도 한도를 넘으면 더는 집지 않는다
--   5. **'processing' 인 채로 죽은 행은 회수된다** — 이게 없으면 잠금이 영구히 남는다
--   6. 완료된 행은 다시 집지 않는다
--
-- 실행: psql -f database/tests/010_transcribe_state.sql

\set ON_ERROR_STOP on
\set MAXTRIES 3
\set STALE '20 minutes'

-- 잠금 시도를 함수로 묶는다. Worker 의 transcribeRecording 첫 쿼리와 **같은 조건**이다.
create or replace function pg_temp.try_claim(p_id uuid) returns boolean
language plpgsql as $$
declare hit int;
begin
  update v2.meeting_recordings
     set transcribe_status     = 'processing',
         transcribe_tries      = transcribe_tries + 1,
         transcribe_error      = null,
         transcribe_started_at = now()
   where id = p_id
     and transcribe_tries < 3
     and (
       transcribe_status in ('pending', 'failed')
       or (transcribe_status = 'processing'
           and coalesce(transcribe_started_at, to_timestamp(0)) < now() - '20 minutes'::interval)
     );
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

insert into v2.users (id, email, password_hash, name, role)
values ('cccc3333-0000-0000-0000-000000000003', 'trans@t.test', 'x', '전사', 'sales_rep')
on conflict (id) do nothing;

delete from v2.meeting_recordings where user_id = 'cccc3333-0000-0000-0000-000000000003';

insert into v2.meeting_recordings (id, user_id, label, storage_path, sort_order)
values ('dddd4444-0000-0000-0000-000000000001', 'cccc3333-0000-0000-0000-000000000003',
        '검증 녹음', 'recordings/dddd4444.webm', 0);

-- ── 1. 기본 상태
select 'T1_DEFAULT_STATUS' as k, transcribe_status as v
  from v2.meeting_recordings where id = 'dddd4444-0000-0000-0000-000000000001';

-- ── 2. 잠금은 한 번만. 연달아 두 번 집어 본다 — 둘째는 실패해야 한다.
select 'T2_FIRST_CLAIM'  as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;
select 'T2_SECOND_CLAIM' as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;
select 'T2_TRIES' as k, transcribe_tries::text as v
  from v2.meeting_recordings where id = 'dddd4444-0000-0000-0000-000000000001';

-- ── 3. 실패로 풀면 다시 집을 수 있다
update v2.meeting_recordings set transcribe_status = 'failed', transcribe_error = '테스트'
 where id = 'dddd4444-0000-0000-0000-000000000001';
select 'T3_RECLAIM_AFTER_FAIL' as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;

-- ── 4. 한도 초과. tries 를 한도까지 올리고 풀어 둔다 — 그래도 못 집어야 한다.
update v2.meeting_recordings set transcribe_status = 'failed', transcribe_tries = 3
 where id = 'dddd4444-0000-0000-0000-000000000001';
select 'T4_CLAIM_AT_LIMIT' as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;

-- ── 5. 죽은 잠금 회수. 'processing' 인데 시작 시각이 오래됐다.
--     한도와 무관하게 확인하려고 tries 를 되돌린다.
update v2.meeting_recordings
   set transcribe_status = 'processing', transcribe_tries = 0,
       transcribe_started_at = now() - interval '25 minutes'
 where id = 'dddd4444-0000-0000-0000-000000000001';
select 'T5_RECLAIM_STALE' as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;

--     반대로 **막 시작한** 잠금은 뺏으면 안 된다 (돌고 있는 전사에 비용을 두 번 낸다)
update v2.meeting_recordings
   set transcribe_status = 'processing', transcribe_tries = 0, transcribe_started_at = now()
 where id = 'dddd4444-0000-0000-0000-000000000001';
select 'T5_KEEP_FRESH' as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;

-- ── 6. 완료된 행은 건드리지 않는다
update v2.meeting_recordings
   set transcribe_status = 'done', transcription = '전사문', transcribed_at = now(), transcribe_tries = 0
 where id = 'dddd4444-0000-0000-0000-000000000001';
select 'T6_CLAIM_WHEN_DONE' as k, pg_temp.try_claim('dddd4444-0000-0000-0000-000000000001')::text as v;

-- ── 7. 제약: 아무 값이나 들어가지 않는다
do $$
declare blocked boolean := false;
begin
  begin
    update v2.meeting_recordings set transcribe_status = '아무거나'
     where id = 'dddd4444-0000-0000-0000-000000000001';
  exception when check_violation then blocked := true;
  end;
  raise notice 'T7_STATUS_CHECK_BLOCKED=%', blocked;
end $$;

delete from v2.meeting_recordings where user_id = 'cccc3333-0000-0000-0000-000000000003';
delete from v2.users where id = 'cccc3333-0000-0000-0000-000000000003';
