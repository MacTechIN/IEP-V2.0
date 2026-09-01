-- 026: 변호사 프로필
--
-- ── 왜 필요한가 ──────────────────────────────────────────────
--
-- 포크 시점의 `v2.users` 는 **영업담당자의 프로필**이다:
--   `department`(부서) · `monthly_target_krw`(월 목표 매출)
--
-- 변호사에게는 `monthly_target_krw` 가 뜻이 없고, 정작 필요한 것이 없다 —
-- **변호사 등록번호**가 없으면 내보낸 서면에 누가 작성했는지 적을 수 없다.
--
-- ── 무엇을 넣나 ──────────────────────────────────────────────
--
-- **꾸미기 위한 칸을 만들지 않는다.** 각 칸이 어디에 쓰이는지 적어 둔다 —
-- 쓰이는 곳이 없으면 그 칸은 곧 비어 있게 되고, 비어 있는 칸은 신뢰를 깎는다.
--
--   `bar_no`           변호사 등록번호 — **내보낸 문서의 작성자 표시**에 쓴다
--   `firm_name`        소속 법무법인·사무소 — 같은 자리
--   `position`         직위 (대표변호사·파트너·어소시에이트·사무장)
--   `bar_association`  소속 지방변호사회
--   `practice_areas`   주요 취급분야 — 사건을 만들 때 청구원인 추천에 쓸 자리
--   `office_phone`     사무실 전화 — 개인 휴대폰(`phone`)과 나눈다.
--                      의뢰인에게 나가는 문서에는 **사무실 번호가 붙어야 한다**
--   `office_address`   사무소 주소
--
-- ── 사무장도 같은 표를 쓴다 ──────────────────────────────────
--
-- 사무장에게는 `bar_no` 가 없다. **필수로 걸지 않는다** —
-- 비워 둘 수 있어야 사무장 계정이 만들어진다. `position` 으로 구분한다.
--
-- ── 영업 칸은 지우지 않는다 ──────────────────────────────────
--
-- `monthly_target_krw` · `department` 는 **화면에서만 감춘다.**
-- 지우면 그 값을 읽는 SEP 상속 코드(대시보드·점수)가 조용히 깨진다.
-- 컬럼을 지우는 것은 그 코드를 정리한 뒤의 일이다.
--
-- **되돌리기**
--   alter table v2.users
--     drop column bar_no, drop column firm_name, drop column position,
--     drop column bar_association, drop column practice_areas,
--     drop column office_phone, drop column office_address;

alter table v2.users
  add column if not exists bar_no          text,
  add column if not exists firm_name       text,
  add column if not exists position        text,
  add column if not exists bar_association text,
  add column if not exists practice_areas  text[],
  add column if not exists office_phone    text,
  add column if not exists office_address  text;

comment on column v2.users.bar_no is
  '변호사 등록번호 (026). **사무장은 비어 있다** — 필수로 걸지 않는다. 내보낸 문서의 작성자 표시에 쓴다.';
comment on column v2.users.practice_areas is
  '주요 취급분야 (026). 사건 생성 시 청구원인 추천에 쓸 자리.';
comment on column v2.users.office_phone is
  '사무실 전화 (026). 개인 휴대폰(phone)과 나눈다 — 의뢰인에게 나가는 문서에는 사무실 번호가 붙어야 한다.';
comment on column v2.users.monthly_target_krw is
  '영업 목표액. **LEP 에서는 쓰지 않는다** — 화면에서 감췄다. 지우지 않은 이유는 SEP 상속 코드가 읽기 때문이다 (026).';

-- 같은 등록번호가 둘이면 문서의 작성자 표시가 거짓이 된다.
-- **비어 있는 것은 여럿이어도 된다** (사무장). partial unique index 로 건다.
create unique index if not exists idx_users_bar_no
  on v2.users (bar_no) where bar_no is not null and deleted_at is null;
