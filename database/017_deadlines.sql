-- 017: 기한 — 놓치면 사건이 진다
--
-- SEP 의 `action_items` 는 "다음에 할 일" 이다. 안 해도 다음에 하면 된다.
-- **법률에서는 날짜가 법적 효력을 가진다.** 소멸시효가 지나면 청구권이 사라지고,
-- 항소기한을 넘기면 판결이 확정된다. 되돌릴 방법이 없다.
--
-- 그래서 `action_items` 를 쓰지 않고 따로 둔다. 성질이 다른 것을 한 표에 담으면
-- 화면이 둘을 같은 무게로 보여 주게 되고, **그 순간 진짜 기한이 할 일 목록에 묻힌다.**
--
-- ── 이 표에서 가장 중요한 컬럼 ──────────────────────────────────
--
-- **`is_estimated`**
--   AI 가 상담 녹취에서 뽑은 기한은 **추정이다.** 기산일을 잘못 잡거나(불법행위는
--   '손해 및 가해자를 안 날'), 중단 사유를 모르거나(청구·압류·승인), 특별법이 적용되는
--   경우를 놓칠 수 있다.
--
--   **추정한 기한을 확정처럼 보여 주면 그게 사고다.** 변호사가 그 날짜를 믿고 움직였는데
--   틀렸다면 되돌릴 수 없다. 그래서 기본값이 `true` 다 — **사람이 확인해야 확정이 된다.**
--   화면은 추정과 확정을 **다르게** 그린다.
--
-- **`basis`**
--   무엇을 근거로 이 날짜가 나왔는지. "민법 제766조 제1항, 2024-03-01 인지" 처럼.
--   근거 없는 날짜는 검증할 수 없고, 검증할 수 없으면 확정으로 바꿀 수도 없다.
--
-- **되돌리기**: `drop table v2.deadlines;`

create table if not exists v2.deadlines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references v2.users(id) on delete cascade,
  -- 기한은 사건에 붙는다. **사건 없는 미팅에서는 기한이 나오지 않는다** (016).
  matter_id   uuid not null references v2.matters(id) on delete cascade,
  -- 어느 상담에서 나왔나. 미팅이 지워져도 기한은 남는다 — 날짜가 사라지면 안 된다.
  meeting_id  uuid references v2.meetings(id) on delete set null,

  kind        text not null
              check (kind in ('prescription',   -- 소멸시효
                              'exclusion',      -- 제척기간
                              'appeal',         -- 항소·상고 기한
                              'filing',         -- 서면 제출
                              'hearing',        -- 기일
                              'notice',         -- 통지·최고
                              'other')),
  title       text not null,
  due_on      date not null,

  -- 기산일과 근거. **둘 다 없으면 확정으로 바꾸지 못하게 한다** (아래 제약).
  starts_on   date,
  basis       text,

  /**
   * 이 날짜가 확인된 것인가, AI 가 추정한 것인가.
   * **기본은 추정이다.** 사람이 근거를 보고 확정으로 바꾼다.
   */
  is_estimated  boolean not null default true,
  confirmed_by  uuid references v2.users(id) on delete set null,
  confirmed_at  timestamptz,

  status      text not null default 'open'
              check (status in ('open', 'done', 'dismissed')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- **확정하려면 누가 언제 확정했는지가 있어야 한다.**
  -- 이게 없으면 "확정됨" 이 아무 뜻이 없다 — 누구도 책임지지 않은 날짜가 된다.
  constraint deadlines_confirm_needs_who
    check (is_estimated or (confirmed_by is not null and confirmed_at is not null))
);

comment on table v2.deadlines is
  '기한 (017). action_items 와 다르다 — 놓치면 되돌릴 수 없다.';
comment on column v2.deadlines.is_estimated is
  'AI 추정이면 true. **기본값이 true 다** — 추정을 확정처럼 보여 주는 것이 이 표의 가장 큰 위험이다.';
comment on column v2.deadlines.basis is
  '이 날짜가 나온 근거. 근거 없는 날짜는 검증할 수 없고, 검증할 수 없으면 확정할 수도 없다.';

-- 대시보드의 기본 질의는 "가까운 것부터, 아직 안 끝난 것" 이다.
create index if not exists idx_deadlines_due
  on v2.deadlines (user_id, due_on) where status = 'open';

-- 사건 화면에서 그 사건의 기한을 모아 본다.
create index if not exists idx_deadlines_matter on v2.deadlines (matter_id, due_on);

-- **확인이 필요한 것만** 빨리 찾는다. 추정인 채로 남아 있는 기한이 곧 할 일이다.
create index if not exists idx_deadlines_unconfirmed
  on v2.deadlines (user_id, due_on) where is_estimated and status = 'open';

/**
 * D-day. 음수면 이미 지났다.
 *
 * 화면마다 계산하면 시간대 때문에 하루씩 어긋난다 — **한 곳에서만 센다.**
 * `date` 끼리 빼므로 시각은 개입하지 않는다.
 */
create or replace function v2.deadline_days_left(d date)
returns integer language sql immutable as $$
  select (d - current_date)::integer
$$;

comment on function v2.deadline_days_left(date) is
  'D-day 계산. 화면마다 따로 세면 시간대로 하루가 어긋난다 — 여기 한 곳에서만 센다 (017).';
