-- 013 검증 — 로그인 시도 제한
--
-- 확인하는 것
--   1. 4번까지는 안 막는다 (사람은 비밀번호를 틀린다)
--   2. 5번째부터 막고, 더 틀리면 더 오래 막는다
--   3. **15분 조용하면 처음부터 다시 센다** — 몇 달치 오타가 쌓여 어느 날 막히면 안 된다
--   4. 성공하면 즉시 풀린다
--   5. 이메일과 IP 는 **따로 센다** (한쪽이 막혀도 다른 쪽 계정은 멀쩡해야 한다)
--   6. 상한 15분을 넘지 않는다 (계정을 영구히 못 쓰게 만들지 않는다)
--
-- 실행: psql -f database/tests/013_login_throttle.sql

\set ON_ERROR_STOP on

do $$
declare
  k text := 'e:throttle-test@t.test';
  ip text := 'i:203.0.113.9';
  u timestamptz;
  n int;
begin
  delete from v2.login_throttle where key in (k, ip);

  -- 1) 네 번까지는 막지 않는다
  for i in 1..4 loop
    u := v2.login_fail(k);
    if u is not null then
      raise exception '% 번째에서 막혔다 — 4번까지는 통과해야 한다', i;
    end if;
  end loop;
  if v2.login_blocked(array[k]) is not null then
    raise exception '4번 실패로 막히면 안 된다';
  end if;

  -- 2) 다섯 번째부터 막힌다
  u := v2.login_fail(k);
  if u is null then raise exception '5번째는 막혀야 한다'; end if;
  if v2.login_blocked(array[k]) is null then
    raise exception 'login_blocked 가 막힌 것을 못 본다';
  end if;

  -- 5) IP 는 따로 센다 — 이메일이 막혔다고 다른 사람이 막히면 안 된다
  if v2.login_blocked(array[ip]) is not null then
    raise exception '이메일 실패가 IP 까지 막았다';
  end if;

  -- 2') 더 틀리면 더 오래 막힌다
  declare first_until timestamptz := u;
  begin
    u := v2.login_fail(k);
    if u <= first_until then
      raise exception '6번째가 5번째보다 오래 막지 않는다 (% → %)', first_until, u;
    end if;
  end;

  -- 6) 상한 15분. 20번 틀려도 그 이상은 아니다.
  for i in 1..14 loop u := v2.login_fail(k); end loop;
  if u > now() + interval '15 minutes' + interval '5 seconds' then
    raise exception '상한 15분을 넘었다: %', u;
  end if;

  -- 4) 성공하면 즉시 풀린다
  perform v2.login_ok(array[k, ip]);
  if v2.login_blocked(array[k]) is not null then
    raise exception '성공했는데 아직 막혀 있다';
  end if;

  -- 3) 15분 조용하면 처음부터 다시 센다.
  --    시간을 못 돌리니 seen 을 과거로 밀어 같은 조건을 만든다.
  perform v2.login_fail(k);
  perform v2.login_fail(k);
  perform v2.login_fail(k);
  update v2.login_throttle set seen = now() - interval '16 minutes' where key = k;
  perform v2.login_fail(k);
  select fails into n from v2.login_throttle where key = k;
  if n <> 1 then
    raise exception '15분 뒤에도 이어서 센다 (fails=%) — 오래된 오타가 쌓인다', n;
  end if;

  delete from v2.login_throttle where key in (k, ip);
  raise notice '013 검증 통과';
end $$;
