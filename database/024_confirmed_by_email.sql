-- 024: 확정한 사람의 이름이 계정보다 오래 남게 한다
--
-- ── 무엇이 부딪혔나 ──────────────────────────────────────────
--
-- 2026-08-26, `023` 을 시험하다 실제로 막혔다:
--
--   6) 이제 지운다
--      거부 409 new row for relation "deadlines"
--               violates check constraint "deadlines_confirm_needs_who"
--
-- `017` 의 제약은 **확정이면 누가 했는지가 있어야 한다**고 말한다 (옳다).
-- `deadlines.confirmed_by` 의 외래키는 **사람이 사라지면 null 로 만든다**고 말한다 (옳다).
--
-- 둘 다 옳은데 **함께 두면 모순이다.** 확정된 기한이 하나라도 있는 사람은
-- 사건을 전부 인계해도 **영원히 지워지지 않는다** — 지우는 순간 그 기한이
-- `is_estimated = false` 이면서 `confirmed_by is null` 이 되어 제약을 깬다.
--
-- ── 어느 쪽을 고치나 ─────────────────────────────────────────
--
-- **제약을 약하게 하지 않는다.** "누가 확정했는지 몰라도 된다" 로 바꾸면
-- `017` 이 막으려던 것("누구도 책임지지 않은 날짜")이 그대로 돌아온다.
--
-- 대신 **기록이 계정에 매달려 있는 것**을 고친다.
-- `access_log` 가 이미 이렇게 되어 있다 — `user_id`(사라질 수 있음)와
-- `user_email`(텍스트, 남음)을 **둘 다** 들고 있다. 같은 방식을 쓴다.
--
--   `confirmed_by`       uuid — 편의용. 계정이 사라지면 null 이 된다
--   `confirmed_by_email` text — **이것이 진짜 기록이다.** 계정보다 오래 남는다
--
-- 제약은 `confirmed_by_email` 을 본다. 사람이 회사를 떠나도
-- **그 날짜를 누가 확정했는지는 남는다.**
--
-- **되돌리기**
--   alter table v2.deadlines drop constraint deadlines_confirm_needs_who;
--   alter table v2.deadlines add constraint deadlines_confirm_needs_who
--     check (is_estimated or (confirmed_by is not null and confirmed_at is not null));
--   alter table v2.deadlines drop column confirmed_by_email;

alter table v2.deadlines
  add column if not exists confirmed_by_email text;

comment on column v2.deadlines.confirmed_by_email is
  '확정한 사람의 이메일 (024). **계정이 지워져도 남는다** — confirmed_by(uuid)는 null 이 되지만 이것은 남는다.';

-- 이미 확정되어 있는 기한을 메운다. 지금은 계정이 살아 있으므로 전부 찾을 수 있다.
update v2.deadlines d
   set confirmed_by_email = u.email
  from v2.users u
 where u.id = d.confirmed_by
   and d.confirmed_by_email is null;

-- 그래도 못 메운 것(계정이 이미 없는 경우)은 흔적을 남긴다 —
-- **빈 채로 두면 아래 제약을 걸 수 없고, 걸지 못하면 이 마이그레이션이 뜻이 없다.**
update v2.deadlines
   set confirmed_by_email = '(알 수 없음)'
 where is_estimated = false
   and confirmed_by_email is null;

alter table v2.deadlines drop constraint if exists deadlines_confirm_needs_who;

-- **확정이면 누가 언제 확정했는지가 있어야 한다** — `017` 의 뜻 그대로다.
-- 다만 「누가」를 계정이 아니라 **텍스트**로 본다. 사람은 회사를 떠나도 기록은 남아야 한다.
alter table v2.deadlines
  add constraint deadlines_confirm_needs_who
  check (is_estimated or (confirmed_by_email is not null and confirmed_at is not null));
