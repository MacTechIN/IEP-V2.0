-- 016 검증 — 사건과 미팅 종류
--
-- 확인하는 것
--   1. `kind` 의 **기본값이 `general`** 이다 (법률 분석을 잘못 거는 쪽이 더 나쁘다)
--   2. 정해진 셋 말고는 못 들어간다
--   3. **사건 없는 미팅이 정상이다** — `matter_id` 도 `customer_id` 도 필수가 아니다
--   4. **사건을 지워도 미팅은 남는다** (연결만 끊긴다)
--   5. 이해충돌 대조가 정규화 이름으로 성립한다
--
-- 실행: psql -f database/tests/016_matters_and_meeting_kind.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; cid uuid; mid uuid;
  m_legal uuid; m_plain uuid; m_internal uuid;
  k text; n int;
begin
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-016@t.test', '검증', 'x', 'user', true)
  on conflict (email) do update set name = excluded.name
  returning id into uid;

  insert into v2.customers (user_id, company_name, name_norm)
  values (uid, '주식회사 가나', '가나') returning id into cid;

  insert into v2.matters (user_id, client_id, title, cause, status, opened_on)
  values (uid, cid, '가나 물품대금', '채무불이행', 'open', current_date)
  returning id into mid;

  -- 1) 기본값은 general 이다
  insert into v2.meetings (user_id, customer_id, matter_id, title, start_time, end_time)
  values (uid, cid, mid, '사건 상담', now(), now()) returning id into m_legal;
  select kind into k from v2.meetings where id = m_legal;
  if k <> 'general' then raise exception '016: kind 기본값이 general 이 아니라 %다', k; end if;

  update v2.meetings set kind = 'legal' where id = m_legal;

  -- 2) 정해진 셋 말고는 못 들어간다
  begin
    update v2.meetings set kind = 'sales' where id = m_legal;
    raise exception '016: kind 가 임의 값을 받았다 — check 제약이 없다';
  exception when check_violation then null;   -- 기대한 결과다
  end;

  -- 3) **사건 없는 미팅이 정상이다** (수임 전 상담 · 자문 문의)
  insert into v2.meetings (user_id, customer_id, title, start_time, end_time)
  values (uid, cid, '수임 전 상담', now(), now()) returning id into m_plain;
  select kind into k from v2.meetings where id = m_plain;
  if k <> 'general' then raise exception '016: 사건 없는 미팅의 기본값이 어긋난다'; end if;

  -- 의뢰인조차 없는 미팅도 정상이다 (내부 회의 · 거래처)
  insert into v2.meetings (user_id, title, start_time, end_time)
  values (uid, '사무소 내부 회의', now(), now()) returning id into m_internal;
  if m_internal is null then raise exception '016: 의뢰인 없는 미팅이 안 들어간다'; end if;

  -- 4) 상대방
  insert into v2.adverse_parties (matter_id, name, name_norm, role)
  values (mid, '㈜다라', '다라', '피고');

  -- 이해충돌: 새 의뢰인 '주식회사 다라' 가 기존 사건의 상대방인가?
  select count(*) into n from v2.adverse_parties where name_norm = '다라';
  if n <> 1 then raise exception '016: 정규화 이름으로 상대방을 못 찾는다 (%건)', n; end if;

  -- 5) **사건을 지워도 미팅은 남는다** — 연결만 끊긴다
  delete from v2.matters where id = mid;
  select count(*) into n from v2.meetings where id = m_legal;
  if n <> 1 then raise exception '016: 사건 삭제로 미팅이 함께 사라졌다'; end if;
  select count(*) into n from v2.meetings where id = m_legal and matter_id is null;
  if n <> 1 then raise exception '016: 연결만 끊겨야 하는데 그렇지 않다'; end if;

  -- 상대방은 사건에 딸린 것이라 함께 사라지는 것이 맞다
  select count(*) into n from v2.adverse_parties where name_norm = '다라';
  if n <> 0 then raise exception '016: 사건을 지웠는데 상대방이 남았다 (%건)', n; end if;

  -- 뒷정리
  delete from v2.meetings where user_id = uid;
  delete from v2.customers where user_id = uid;
  delete from v2.users where id = uid;

  raise notice '016 통과 — 기본값 general · 제약 · 사건/의뢰인 없는 미팅 · 삭제 시 잔존 · 정규화 대조';
end $$;
