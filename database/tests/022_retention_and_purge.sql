-- 022 검증 — 보관 기간과 파기
--
-- 확인하는 것
--   1. **보관 연수가 없으면 파기 대상에 오르지 않는다** — 모르면 지우지 않는다
--   2. 종결되지 않았거나 기간이 안 지났으면 오르지 않는다
--   3. 셋이 다 맞아야 오른다
--   4. **`purge_matter()` 가 외래키 순서에 막히지 않는다** ← 이 함수의 존재 이유
--   5. **`access_log` 는 남는다** — 파기했다는 사실이 사라지면 안 된다
--
-- 실행: psql -f database/tests/022_retention_and_purge.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; cid uuid; mid uuid; meet uuid; n int; res jsonb; logs_before int; logs_after int;
begin
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-022@t.test','검증','x','user',true)
  on conflict (email) do update set name=excluded.name returning id into uid;
  insert into v2.customers (user_id, company_name) values (uid,'검증의뢰인') returning id into cid;
  insert into v2.matters (user_id, client_id, title, cause, status, opened_on, closed_on)
  values (uid, cid, '파기 검증', '채무불이행', 'closed', current_date - 4000, current_date - 3000)
  returning id into mid;

  -- 1) 보관 연수가 없으면 오르지 않는다
  select count(*) into n from v2.purge_candidates where matter_id = mid;
  if n <> 0 then raise exception '022: 보관 연수 없이 파기 대상에 올랐다 — 모르면 지우면 안 된다'; end if;

  -- 2) 기간이 안 지났으면 오르지 않는다
  update v2.matters set retention_years = 50 where id = mid;
  select count(*) into n from v2.purge_candidates where matter_id = mid;
  if n <> 0 then raise exception '022: 기간이 안 지났는데 파기 대상에 올랐다'; end if;

  -- 종결되지 않았으면 오르지 않는다
  update v2.matters set retention_years = 1, status = 'open' where id = mid;
  select count(*) into n from v2.purge_candidates where matter_id = mid;
  if n <> 0 then raise exception '022: 종결되지 않았는데 파기 대상에 올랐다'; end if;

  -- 3) 셋이 다 맞으면 오른다
  update v2.matters set status = 'closed' where id = mid;
  select count(*) into n from v2.purge_candidates where matter_id = mid;
  if n <> 1 then raise exception '022: 조건이 다 맞는데 파기 대상에 안 올랐다'; end if;

  -- 4) **외래키를 전부 만들어 두고 파기한다** — 이게 이 함수의 존재 이유다
  insert into v2.meetings (user_id, customer_id, matter_id, title, start_time, end_time, kind)
  values (uid, cid, mid, '상담', now(), now(), 'legal') returning id into meet;
  insert into v2.meeting_recordings (user_id, meeting_id, label, storage_path, duration_seconds,
    segments, selected, sort_order, transcribe_status)
  values (uid, meet, '녹음', 'recordings/t022.wav', 60, '[]'::jsonb, true, 0, 'done');
  insert into v2.transcript_segments (meeting_id, speaker_label, speaker_id, content, start_ms, end_ms, sort_order)
  values (meet, '화자 A', 'A', '내용', 0, 1000, 0);
  insert into v2.analysis_results (meeting_id) values (meet);
  insert into v2.legal_analyses (meeting_id, matter_id, result) values (meet, mid, '{}'::jsonb);
  insert into v2.findings (meeting_id, matter_id, kind, detail) values (meet, mid, 'GAP', 'x');
  insert into v2.timeline_events (matter_id, meeting_id, what) values (mid, meet, 'x');
  insert into v2.evidence (matter_id, meeting_id, kind, what) values (mid, meet, '문자', 'x');
  insert into v2.deadlines (user_id, matter_id, meeting_id, kind, title, due_on)
  values (uid, mid, meet, 'appeal', '항소기한', current_date + 10);
  insert into v2.pii_masks (meeting_id, kind, token, original)
  values (meet, 'PHONE', '[PHONE_1]', '010-0000-0000');
  perform v2.seed_legal_elements(mid, '채무불이행');

  -- 감사 기록은 파기해도 남아야 한다
  insert into v2.access_log (user_id, user_email, action, target, target_id, matter_id)
  values (uid, 't-022@t.test', 'view', 'legal', meet, mid);
  select count(*) into logs_before from v2.access_log where matter_id = mid;

  res := v2.purge_matter(mid);

  -- 전부 사라졌는가
  if exists (select 1 from v2.matters  where id = mid)        then raise exception '022: 사건이 남았다'; end if;
  if exists (select 1 from v2.meetings where id = meet)       then raise exception '022: 미팅이 남았다'; end if;
  select count(*) into n from v2.transcript_segments where meeting_id = meet;
  if n <> 0 then raise exception '022: 녹취가 남았다 (%건)', n; end if;
  select count(*) into n from v2.meeting_recordings where meeting_id = meet;
  if n <> 0 then raise exception '022: 녹음이 남았다 (%건)', n; end if;
  select count(*) into n from v2.legal_elements where matter_id = mid;
  if n <> 0 then raise exception '022: 요건이 남았다 (%건)', n; end if;
  select count(*) into n from v2.deadlines where matter_id = mid;
  if n <> 0 then raise exception '022: 기한이 남았다 (%건)', n; end if;
  select count(*) into n from v2.pii_masks where meeting_id = meet;
  if n <> 0 then raise exception '022: 비식별 대응표가 남았다 (%건)', n; end if;

  -- 5) **감사 기록은 남는다**
  select count(*) into logs_after from v2.access_log where matter_id = mid;
  if logs_after <> logs_before then
    raise exception '022: 파기가 감사 기록을 지웠다 (% → %) — 파기했다는 사실이 사라지면 안 된다',
      logs_before, logs_after;
  end if;

  raise notice '022 통과 — 대상 조건 셋 · 외래키 순서 · 감사 잔존. 파기 결과: %', res;

  delete from v2.access_log where matter_id = mid;
  delete from v2.customers where user_id = uid;
  delete from v2.sessions where user_id = uid;
  delete from v2.users where id = uid;
end $$;
