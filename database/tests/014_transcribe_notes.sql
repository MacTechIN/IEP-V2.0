-- 014 검증 — 전사 등급 강등 기록
--
-- 확인하는 것
--   1. 컬럼이 있고 기본값이 null 이다 (옛 행은 아무것도 주장하지 않는다)
--   2. jsonb 를 그대로 넣고 그대로 읽는다
--   3. **부분 인덱스가 whisper 행만 잡는다** — 정상 행은 색인하지 않는다
--   4. 두 번 돌려도 안전하다 (add column if not exists · create index if not exists)
--
-- 실행: psql -f database/tests/014_transcribe_notes.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid;
  ok_id  uuid := gen_random_uuid();
  bad_id uuid := gen_random_uuid();
  got jsonb;
  n int;
begin
  -- 1) 컬럼이 있는가
  select count(*) into n from information_schema.columns
   where table_schema = 'v2' and table_name = 'meeting_recordings'
     and column_name = 'transcribe_notes' and data_type = 'jsonb';
  if n <> 1 then raise exception '014: transcribe_notes jsonb 컬럼이 없다'; end if;

  -- 테스트용 사용자 (외래키 때문에 필요하다)
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-014@t.test', '검증', 'x', 'user', true)
  on conflict (email) do update set name = excluded.name
  returning id into uid;

  insert into v2.meeting_recordings
    (id, user_id, label, storage_path, duration_seconds, segments, selected, sort_order, transcribe_status)
  values
    (ok_id,  uid, '정상',   'recordings/t-ok.wav',  600, '[]'::jsonb, true, 0, 'done'),
    (bad_id, uid, '강등됨', 'recordings/t-bad.wav', 620, '[]'::jsonb, true, 1, 'done');

  -- 2) 기본값은 null 이다 — 옛 행이 "정상이었다" 고 주장하면 안 된다
  select transcribe_notes into got from v2.meeting_recordings where id = ok_id;
  if got is not null then raise exception '014: 기본값이 null 이 아니다'; end if;

  -- 3) 넣은 대로 읽힌다
  update v2.meeting_recordings
     set transcribe_notes = jsonb_build_object(
           'engine', 'whisper', 'enrolled', 1, 'matched', 0,
           'attempts', 2, 'retried_without_refs', false, 'collapsed', 0,
           'diarize_error', '500 upstream')
   where id = bad_id;
  update v2.meeting_recordings
     set transcribe_notes = jsonb_build_object(
           'engine', 'diarize', 'enrolled', 1, 'matched', 1, 'attempts', 1)
   where id = ok_id;

  select transcribe_notes into got from v2.meeting_recordings where id = bad_id;
  if got->>'engine' <> 'whisper' then raise exception '014: engine 이 그대로 읽히지 않는다'; end if;
  if got->>'diarize_error' <> '500 upstream' then raise exception '014: diarize_error 가 어긋난다'; end if;
  if (got->>'matched')::int <> 0 then raise exception '014: matched 가 어긋난다'; end if;

  -- 4) "등급이 내려간 것만" 골라내는 질의가 성립한다
  select count(*) into n from v2.meeting_recordings
   where user_id = uid and transcribe_notes->>'engine' = 'whisper';
  if n <> 1 then raise exception '014: whisper 행이 1개여야 하는데 %개다', n; end if;

  -- 등록 목소리를 넘겼는데 하나도 안 붙은 경우도 같은 방식으로 잡힌다
  select count(*) into n from v2.meeting_recordings
   where user_id = uid
     and (transcribe_notes->>'enrolled')::int > 0
     and (transcribe_notes->>'matched')::int = 0;
  if n <> 1 then raise exception '014: 목소리 미매칭 행이 1개여야 하는데 %개다', n; end if;

  -- 뒷정리
  delete from v2.meeting_recordings where user_id = uid;
  delete from v2.users where id = uid;

  raise notice '014 통과 — 컬럼·기본값·왕복·강등 질의 모두 확인';
end $$;

-- 5) 부분 인덱스가 걸려 있는가 (정상 행까지 색인하면 값어치가 없다)
do $$
declare n int;
begin
  select count(*) into n from pg_indexes
   where schemaname = 'v2' and indexname = 'idx_recordings_degraded'
     and indexdef ilike '%where%whisper%';
  if n <> 1 then raise exception '014: 부분 인덱스 idx_recordings_degraded 가 없다'; end if;
  raise notice '014 통과 — 부분 인덱스 확인';
end $$;
