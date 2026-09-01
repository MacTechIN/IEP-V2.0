-- 018 검증 — 법률 분석 저장
--
-- 확인하는 것
--   1. 청구원인 셋의 요건 틀이 들어 있다
--   2. `seed_legal_elements` 가 사건에 요건을 깔고, **다시 돌려도 사람이 고친 것을 안 덮는다**
--   3. **모순은 refs 둘 이상 없이 못 들어간다** — 못 가리키는 모순은 주장일 뿐이다
--   4. 요건은 **사건 단위로 쌓인다** — 2회 상담이 1회의 빈 요건을 채운다
--   5. 미팅을 지워도 사건 자료(요건·타임라인·증거)는 남는다
--   6. 증거 상태·난이도 제약
--
-- 실행: psql -f database/tests/018_legal_analysis.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; cid uuid; mid uuid; m1 uuid; m2 uuid;
  n int; st text; v_note text;
begin
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-018@t.test', '검증', 'x', 'user', true)
  on conflict (email) do update set name = excluded.name returning id into uid;
  insert into v2.customers (user_id, company_name) values (uid, '검증의뢰인') returning id into cid;
  insert into v2.matters (user_id, client_id, title, cause)
  values (uid, cid, '물품대금', '채무불이행') returning id into mid;
  insert into v2.meetings (user_id, customer_id, matter_id, title, start_time, end_time, kind)
  values (uid, cid, mid, '1회 상담', now(), now(), 'legal') returning id into m1;
  insert into v2.meetings (user_id, customer_id, matter_id, title, start_time, end_time, kind)
  values (uid, cid, mid, '2회 상담', now(), now(), 'legal') returning id into m2;

  -- 1) 청구원인 셋
  select count(distinct cause) into n from v2.element_templates where user_id is null;
  if n <> 3 then raise exception '018: 청구원인이 3개여야 하는데 %개다', n; end if;
  select count(*) into n from v2.element_templates where cause = '채무불이행' and user_id is null;
  if n <> 6 then raise exception '018: 채무불이행 요건이 6개여야 하는데 %개다', n; end if;

  -- 2) 사건에 요건을 깐다
  n := v2.seed_legal_elements(mid, '채무불이행');
  if n <> 6 then raise exception '018: 요건 6개가 깔려야 하는데 %개다', n; end if;

  -- **사람이 고친 것을 다시 돌려도 안 덮는다**
  update v2.legal_elements set status = 'SATISFIED', note = '계약서 확보'
   where matter_id = mid and element = '채무의 존재';
  n := v2.seed_legal_elements(mid, '채무불이행');
  if n <> 0 then raise exception '018: 다시 깔았더니 %개가 들어갔다 — 덮으면 안 된다', n; end if;
  select status, note into st, v_note from v2.legal_elements
   where matter_id = mid and element = '채무의 존재';
  if st <> 'SATISFIED' or v_note is null then
    raise exception '018: 사람이 고친 상태가 덮였다 (status=%)', st;
  end if;

  -- 4) 요건은 사건 단위로 쌓인다 — 2회 상담이 1회의 빈 요건을 채운다
  update v2.legal_elements
     set status = 'PARTIAL', updated_by_meeting = m2, updated_at = now()
   where matter_id = mid and element = '인과관계';
  select count(*) into n from v2.legal_elements
   where matter_id = mid and status in ('MISSING', 'PARTIAL');
  if n <> 5 then raise exception '018: 아직 안 채워진 요건이 5개여야 하는데 %개다', n; end if;

  -- 3) **모순은 refs 둘 이상**
  begin
    insert into v2.findings (meeting_id, matter_id, kind, severity, detail, refs)
    values (m1, mid, 'INCONSISTENCY', 'HIGH', '날짜가 어긋난다', '["f1"]'::jsonb);
    raise exception '018: 모순이 refs 하나로 들어갔다 — 무엇과 어긋나는지 못 가리킨다';
  exception when check_violation then null;   -- 기대한 결과다
  end;
  insert into v2.findings (meeting_id, matter_id, kind, severity, detail, refs, question)
  values (m1, mid, 'INCONSISTENCY', 'HIGH', '변제기 진술이 어긋난다',
          '["f1","f4"]'::jsonb, '변제기가 5월인지 7월인지 확인');
  -- 다른 종류는 refs 가 없어도 된다 (누락은 가리킬 것이 없다)
  insert into v2.findings (meeting_id, matter_id, kind, severity, detail)
  values (m1, mid, 'GAP', 'MEDIUM', '귀책사유에 대한 진술이 없다');

  -- 분석 원문
  insert into v2.legal_analyses (meeting_id, matter_id, result, model, persona_rev)
  values (m1, mid, '{"case_summary":{"matter_type":"민사"}}'::jsonb, 'gpt-4o', '2026-08-25');

  -- 5) 타임라인·증거
  insert into v2.timeline_events (matter_id, meeting_id, occurred_on, precision, what, legal_meaning)
  values (mid, m1, date '2024-03-01', 'EXACT', '차용증 작성 후 5,000만원 입금', '계약 체결');
  -- **날짜 불명도 정상이다** — 모른다고 적는 것이 추정을 확정으로 그리는 것보다 낫다
  insert into v2.timeline_events (matter_id, meeting_id, precision, what)
  values (mid, m1, 'UNKNOWN', '독촉 문자를 보냈다고 함');

  insert into v2.evidence (matter_id, meeting_id, kind, what, status, holder, difficulty, proves)
  values (mid, m1, '차용증', '2024-03-01자 차용증', 'PROMISED', '의뢰인', 1, '채무의 존재');

  -- 6) 제약
  begin
    insert into v2.evidence (matter_id, kind, what, status) values (mid, '문자', 'x', 'MAYBE');
    raise exception '018: evidence status 가 임의 값을 받았다';
  exception when check_violation then null;
  end;
  begin
    insert into v2.evidence (matter_id, kind, what, difficulty) values (mid, '문자', 'x', 9);
    raise exception '018: difficulty 가 1~5 밖의 값을 받았다';
  exception when check_violation then null;
  end;

  -- 5) **미팅을 지워도 사건 자료는 남는다**
  delete from v2.meetings where id = m1;
  select count(*) into n from v2.timeline_events where matter_id = mid;
  if n <> 2 then raise exception '018: 미팅 삭제로 타임라인이 사라졌다 (%건 남음)', n; end if;
  select count(*) into n from v2.evidence where matter_id = mid;
  if n <> 1 then raise exception '018: 미팅 삭제로 증거가 사라졌다'; end if;
  -- findings 와 분석 원문은 그 상담의 것이라 함께 간다
  select count(*) into n from v2.findings where matter_id = mid;
  if n <> 0 then raise exception '018: 상담을 지웠는데 findings 가 남았다 (%건)', n; end if;

  -- 뒷정리
  delete from v2.matters where id = mid;
  delete from v2.meetings where user_id = uid;
  delete from v2.customers where user_id = uid;
  delete from v2.users where id = uid;

  raise notice '018 통과 — 요건 틀 셋 · 덮지 않는 seed · 모순 refs 제약 · 사건 단위 누적 · 미팅 삭제 후 잔존';
end $$;
