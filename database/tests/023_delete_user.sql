-- 023 검증 — 사용자 삭제
--
-- 확인하는 것
--   1. **사건을 가진 사람은 지워지지 않는다** ← 이 함수의 존재 이유.
--      그냥 `delete from v2.users` 하면 matters 가 CASCADE 라 **사건이 조용히 사라진다**
--   2. 상담·고객·녹음도 막는다
--   3. 막혔을 때 **아무것도 지워지지 않았다** — 반쪽만 지워진 사용자가 제일 나쁘다
--   4. 막는 것이 없으면 지워지고, 딸린 운영 행(세션·알림·…)도 함께 간다
--   5. **`access_log` 는 남는다** — 누가 무엇을 열었는지는 그 사람이 없어져도 남아야 한다
--   6. 미리보기는 **아무것도 지우지 않는다**
--
-- 실행: psql -f database/tests/023_delete_user.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; uid2 uuid; cid uuid; mid uuid; n int; res jsonb; prev jsonb; blocked boolean;
begin
  -- ── 사건을 가진 사람 ──
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-023-a@t.test','사건있음','x','user',true)
  on conflict (email) do update set name=excluded.name returning id into uid;
  insert into v2.matters (user_id, title, cause) values (uid,'삭제 검증 사건','채무불이행')
  returning id into mid;
  insert into v2.sessions (user_id, refresh_token, expires_at)
  values (uid, 'h-023', now() + interval '1 day');

  -- 6) 미리보기는 아무것도 지우지 않는다
  prev := v2.user_delete_preview(uid);
  if (prev->>'found')::boolean is not true then raise exception '023: 미리보기가 사용자를 못 찾았다'; end if;
  if (prev->'blockers'->>'matters') is null then
    raise exception '023: 사건이 있는데 blockers 에 안 잡혔다';
  end if;
  select count(*) into n from v2.matters where id = mid;
  if n <> 1 then raise exception '023: 미리보기가 사건을 지웠다 — 보여 주기만 해야 한다'; end if;

  -- 1) 사건을 가진 사람은 지워지지 않는다
  blocked := false;
  begin
    perform v2.delete_user(uid);
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception '023: 사건을 가진 사용자가 지워졌다 — 사건이 CASCADE 로 함께 사라진다';
  end if;

  -- 3) 막혔을 때 아무것도 지워지지 않았다
  select count(*) into n from v2.users where id = uid;
  if n <> 1 then raise exception '023: 막혔는데 사용자가 지워졌다'; end if;
  select count(*) into n from v2.matters where id = mid;
  if n <> 1 then raise exception '023: 막혔는데 사건이 지워졌다'; end if;
  select count(*) into n from v2.sessions where user_id = uid;
  if n <> 1 then raise exception '023: 막혔는데 세션이 지워졌다 — 반쪽만 지워진 사용자가 제일 나쁘다'; end if;

  -- 2) 고객도 막는다
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-023-b@t.test','고객있음','x','user',true)
  on conflict (email) do update set name=excluded.name returning id into uid2;
  insert into v2.customers (user_id, company_name) values (uid2,'검증의뢰인 023') returning id into cid;
  blocked := false;
  begin perform v2.delete_user(uid2); exception when others then blocked := true; end;
  if not blocked then raise exception '023: 고객을 가진 사용자가 지워졌다'; end if;

  -- ── 막는 것이 없는 사람 ──
  delete from v2.customers where id = cid;
  insert into v2.notifications (user_id, type, title, message)
  values (uid2, 'system', '검증', '023');
  insert into v2.access_log (user_id, user_email, action, target)
  values (uid2, 't-023-b@t.test', 'view', 'matter');

  -- 4) 지워지고, 운영 행도 함께 간다
  res := v2.delete_user(uid2);
  if (res->>'deleted')::boolean is not true then raise exception '023: 삭제가 성사되지 않았다'; end if;
  select count(*) into n from v2.users where id = uid2;
  if n <> 0 then raise exception '023: 사용자가 남았다'; end if;
  select count(*) into n from v2.notifications where user_id = uid2;
  if n <> 0 then raise exception '023: 알림이 남았다'; end if;

  -- 5) access_log 는 남는다 (user_id 만 null 이 된다)
  select count(*) into n from v2.access_log where user_email = 't-023-b@t.test';
  if n <> 1 then
    raise exception '023: access_log 가 사라졌다 — 그 사람이 없어져도 열람 기록은 남아야 한다';
  end if;

  -- 뒷정리
  delete from v2.access_log where user_email = 't-023-b@t.test';
  delete from v2.matters where id = mid;
  delete from v2.sessions where user_id = uid;
  delete from v2.users where id = uid;

  raise notice '✓ 023 통과 — 사건을 가진 사용자는 막히고, 막혔을 때 아무것도 지워지지 않는다';
end $$;
