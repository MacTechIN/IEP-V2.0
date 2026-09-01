-- 013: 로그인 시도 제한
--
-- 왜 필요한가
--   2026-08-15 에 확인했다 — 로그인에 **횟수 제한이 전혀 없었다.** 비밀번호를
--   무한정 시도할 수 있고, 최소 길이가 9자뿐이라 시간만 있으면 뚫린다.
--
-- 왜 DB 인가
--   Worker 에 KV 도 Durable Object 도 없다(wrangler.toml). Hyperdrive 로 Postgres 는
--   어차피 로그인마다 닿으므로, 여기에 두면 인스턴스가 몇 개든 **정확히 하나로 센다.**
--   Workers 의 내장 rate limit 은 colo 단위라 분산 시도에 그만큼 뚫린다.
--
-- **계정을 잠그지 않는다. 기다리게만 한다.**
--   `is_active` 를 건드리면 남의 이메일로 5번 틀려서 그 사람을 로그아웃시킬 수 있다.
--   여기서는 최대 15분 지연이 전부이고, 성공하면 즉시 지워진다.
--   그래도 남의 계정을 15분 막는 것은 가능하다 — 무한 대입을 막는 값이 더 크다고 봤다.
--
-- 두 축으로 센다
--   `e:<이메일>` — 한 계정을 노리는 대입
--   `i:<IP>`     — 여러 계정에 조금씩 뿌리는 대입 (이메일 기준으로는 안 잡힌다)

begin;

create table if not exists v2.login_throttle (
  key   text primary key,          -- 'e:<email>' 또는 'i:<ip>'
  fails int not null default 0,
  until timestamptz,               -- 이 시각까지 거절
  seen  timestamptz not null default now()
);

-- 오래된 행을 걷어내는 데 쓴다.
create index if not exists idx_login_throttle_seen on v2.login_throttle (seen);

comment on table v2.login_throttle is
  '로그인 실패 횟수. 사용자 데이터가 아니라 임시 카운터다 — 하루 지난 행은 스스로 지운다.';

-- ── 실패를 기록하고, 언제까지 기다려야 하는지 돌려준다.
create or replace function v2.login_fail(p_key text)
returns timestamptz
language plpgsql
as $$
declare
  n int;
  u timestamptz;
begin
  insert into v2.login_throttle (key, fails, seen)
  values (p_key, 1, now())
  on conflict (key) do update
    -- **15분 조용하면 처음부터 다시 센다.** 안 그러면 몇 달에 걸친 오타가 쌓여
    -- 멀쩡한 사용자가 어느 날 갑자기 막힌다.
    set fails = case when v2.login_throttle.seen < now() - interval '15 minutes'
                     then 1 else v2.login_throttle.fails + 1 end,
        seen  = now()
  returning fails into n;

  -- 4번까지는 그냥 센다 — 사람은 비밀번호를 틀린다.
  -- 5번째부터 기다리게 한다: 1분 → 2 → 4 → 8 → 최대 15분.
  if n >= 5 then
    u := now() + least(interval '15 minutes',
                       make_interval(mins => (2 ^ least(n - 5, 4))::int));
    update v2.login_throttle set until = u where key = p_key;
  end if;

  -- 임시 카운터라 쌓아 둘 이유가 없다. 사용자 데이터가 아니므로
  -- '자동으로 지우는 청소기를 만들지 않는다' 원칙의 대상이 아니다.
  delete from v2.login_throttle where seen < now() - interval '1 day';

  return u;
end $$;

-- ── 지금 막혀 있나. 막혀 있으면 풀리는 시각을, 아니면 null 을 돌려준다.
create or replace function v2.login_blocked(p_keys text[])
returns timestamptz
language sql
stable
as $$
  select max(until) from v2.login_throttle
   where key = any(p_keys) and until > now()
$$;

-- ── 성공하면 지운다. 다음 로그인이 처음부터 시작한다.
create or replace function v2.login_ok(p_keys text[])
returns void
language sql
as $$
  delete from v2.login_throttle where key = any(p_keys)
$$;

commit;
