-- 017 검증 — 기한
--
-- 확인하는 것
--   1. **기본이 추정(`is_estimated = true`)이다** — 이 표의 가장 큰 위험이 그 반대다
--   2. **누가 언제 확정했는지 없이는 확정으로 못 바꾼다** — 책임 없는 확정을 막는다
--   3. 미팅을 지워도 기한은 남는다 (날짜가 사라지면 안 된다)
--   4. 사건을 지우면 기한도 함께 간다 (사건 없는 기한은 뜻이 없다)
--   5. D-day 가 한 곳에서 계산된다
--   6. "확인이 필요한 것" 질의가 성립한다
--
-- 실행: psql -f database/tests/017_deadlines.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; cid uuid; mid uuid; meet uuid; did uuid;
  est boolean; n int; dleft int;
begin
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-017@t.test', '검증', 'x', 'user', true)
  on conflict (email) do update set name = excluded.name
  returning id into uid;

  insert into v2.customers (user_id, company_name) values (uid, '검증의뢰인') returning id into cid;
  insert into v2.matters (user_id, client_id, title, cause)
  values (uid, cid, '대여금 반환', '채무불이행') returning id into mid;
  insert into v2.meetings (user_id, customer_id, matter_id, title, start_time, end_time, kind)
  values (uid, cid, mid, '초회 상담', now(), now(), 'legal') returning id into meet;

  -- 1) **기본이 추정이다**
  insert into v2.deadlines (user_id, matter_id, meeting_id, kind, title, due_on, starts_on, basis)
  values (uid, mid, meet, 'prescription', '대여금 소멸시효',
          current_date + 400, current_date - 2200, '민법 제162조 제1항, 변제기 2020-xx-xx')
  returning id, is_estimated into did, est;
  if est is not true then raise exception '017: 기본이 추정이 아니다 — 추정을 확정처럼 보여 주면 그게 사고다'; end if;

  -- 2) **누가 언제 확정했는지 없이는 확정으로 못 바꾼다**
  begin
    update v2.deadlines set is_estimated = false where id = did;
    raise exception '017: 확정한 사람 없이 확정으로 바뀌었다 — 책임 없는 날짜가 생긴다';
  exception when check_violation then null;   -- 기대한 결과다
  end;

  update v2.deadlines
     set is_estimated = false, confirmed_by = uid, confirmed_at = now()
   where id = did;
  select is_estimated into est from v2.deadlines where id = did;
  if est is not false then raise exception '017: 확인해도 확정으로 안 바뀐다'; end if;

  -- 3) **미팅을 지워도 기한은 남는다**
  delete from v2.meetings where id = meet;
  select count(*) into n from v2.deadlines where id = did;
  if n <> 1 then raise exception '017: 미팅 삭제로 기한이 사라졌다'; end if;
  select count(*) into n from v2.deadlines where id = did and meeting_id is null;
  if n <> 1 then raise exception '017: 연결만 끊겨야 하는데 그렇지 않다'; end if;

  -- 5) D-day
  select v2.deadline_days_left(due_on) into dleft from v2.deadlines where id = did;
  if dleft <> 400 then raise exception '017: D-day 가 400 이어야 하는데 %다', dleft; end if;
  -- 지난 기한은 음수다
  if v2.deadline_days_left(current_date - 5) <> -5 then
    raise exception '017: 지난 기한이 음수로 안 나온다';
  end if;

  -- 6) 확인이 필요한 것 = 추정인 채로 열려 있는 것
  insert into v2.deadlines (user_id, matter_id, kind, title, due_on)
  values (uid, mid, 'appeal', '항소기한', current_date + 10);
  select count(*) into n from v2.deadlines
   where user_id = uid and is_estimated and status = 'open';
  if n <> 1 then raise exception '017: 미확인 기한이 1건이어야 하는데 %건이다', n; end if;

  -- 4) **사건을 지우면 기한도 함께 간다**
  delete from v2.matters where id = mid;
  select count(*) into n from v2.deadlines where user_id = uid;
  if n <> 0 then raise exception '017: 사건을 지웠는데 기한이 %건 남았다', n; end if;

  -- 뒷정리
  delete from v2.customers where user_id = uid;
  delete from v2.users where id = uid;

  raise notice '017 통과 — 기본 추정 · 확정에 책임자 필수 · 미팅 삭제 후 잔존 · 사건 삭제 시 정리 · D-day';
end $$;
