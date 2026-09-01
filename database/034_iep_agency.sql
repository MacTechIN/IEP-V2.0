-- 034 — 소속 기관: 경찰 / 해양경찰.
--
-- 계급(순경~경정)은 두 기관이 같지만 **담당 분야가 다르다** — 경찰(경제·지능·사이버…)과
-- 해양경찰(해양오염·해상안전·해양범죄…). 그래서 기관을 먼저 나눈다.
-- 조서·수사보고의 작성자 표시와 통계 분류에 쓴다.
--
-- 멱등: add column if not exists.
alter table v2.users add column if not exists agency text
  check (agency is null or agency in ('police', 'coast_guard'));

comment on column v2.users.agency is '소속 기관: police(경찰) | coast_guard(해양경찰). null=미지정';
