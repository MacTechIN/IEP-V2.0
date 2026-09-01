-- 024 검증 — 확정한 사람의 이름이 계정보다 오래 남는다
--
-- 확인하는 것
--   1. **확정한 사람을 지워도 기한이 살아남는다** ← 이 마이그레이션의 존재 이유.
--      `023` 을 시험하다 실제로 여기서 막혔다 (2026-08-26)
--   2. 계정이 사라져도 **누가 확정했는지는 남는다** (`confirmed_by_email`)
--   3. **제약이 약해지지 않았다** — 이메일 없이 확정으로 만들면 여전히 막힌다
--
-- 실행: psql -f database/tests/024_confirmed_by_email.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; mid uuid; did uuid; n int; who text; failed boolean;
begin
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-024@t.test','확정자','x','user',true)
  on conflict (email) do update set name=excluded.name returning id into uid;
  insert into v2.matters (user_id, title, cause) values (uid,'024 검증','불법행위') returning id into mid;

  -- 그 사람이 기한을 확정한다
  insert into v2.deadlines (user_id, matter_id, kind, title, due_on,
                            is_estimated, confirmed_by, confirmed_by_email, confirmed_at)
  values (uid, mid, 'filing', '024 확정 기한', current_date + 30,
          false, uid, 't-024@t.test', now())
  returning id into did;

  -- 3) 제약이 약해지지 않았다 — 이메일 없이 확정은 여전히 막힌다
  failed := false;
  begin
    insert into v2.deadlines (user_id, matter_id, kind, title, due_on, is_estimated, confirmed_at)
    values (uid, mid, 'filing', '이메일 없는 확정', current_date + 30, false, now());
  exception when check_violation then failed := true;
  end;
  if not failed then
    raise exception '024: 누가 확정했는지 없이 확정이 들어갔다 — 017 이 막으려던 것이 돌아왔다';
  end if;

  -- 사건을 다른 사람에게 넘긴 셈으로 치고, 그 사람을 지운다
  update v2.matters   set user_id = (select id from v2.users where email='admin@company.com' limit 1)
   where id = mid and exists (select 1 from v2.users where email='admin@company.com');
  update v2.deadlines set user_id = (select user_id from v2.matters where id = mid) where matter_id = mid;

  -- 1) **확정한 사람을 지워도 기한이 살아남는다**
  delete from v2.users where id = uid;

  select count(*) into n from v2.deadlines where id = did;
  if n <> 1 then
    raise exception '024: 확정한 사람을 지우니 기한이 사라졌다';
  end if;

  -- 2) 누가 확정했는지는 남는다
  select confirmed_by_email into who from v2.deadlines where id = did;
  if who is distinct from 't-024@t.test' then
    raise exception '024: 확정한 사람의 이름이 사라졌다 (%) — 계정보다 오래 남아야 한다', who;
  end if;
  select count(*) into n from v2.deadlines where id = did and confirmed_by is null;
  if n <> 1 then
    raise exception '024: confirmed_by 가 null 이 되지 않았다 — 외래키가 SET NULL 이어야 한다';
  end if;

  -- 뒷정리
  delete from v2.deadlines where matter_id = mid;
  delete from v2.matters where id = mid;

  raise notice '✓ 024 통과 — 계정은 사라져도 누가 확정했는지는 남는다';
end $$;
