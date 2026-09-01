-- 031: IEP — 조사 종류(kind) 를 수사 도메인으로
--
-- ── 왜 새 마이그레이션인가 ──────────────────────────────────
--
-- 016 이 `meetings.kind` 를 `('legal','business','general')` 로 못박았다(CHECK).
-- IEP 의 조사 종류는 다르다 — 신문·참고인·피해자·면담·회의.
-- **016 을 고치지 않는다.** 이미 적용된 마이그레이션은 되돌리지 않는 것이 규율이다.
-- 제약을 바꿔 덧씌운다.
--
-- ── IEP 조사 종류 (개발계획 §6-A) ──────────────────────────
--   interrogation  피의자 신문      모순·미확인·절차 점검
--   witness        참고인 조사      요지·확인 필요
--   victim         피해자 조사      요지 정리 (압박성 코칭·모순 짚기 없음)
--   interview      일반 면담/대화   요지·다음 확인
--   meeting        수사 회의        결정·다음 할 일 (대상자 분석 없음)
--
-- 기본값은 `interview`(가장 중립). 옛 'general' 도 당분간 허용 —
-- 016 이 넣은 default 'general' 로 만들어진 행이 있을 수 있어서다.

begin;

-- 옛 제약을 떼고 IEP 종류로 다시 건다.
alter table v2.meetings drop constraint if exists meetings_kind_check;
alter table v2.meetings
  add constraint meetings_kind_check
  check (kind in ('interrogation', 'witness', 'victim', 'interview', 'meeting', 'general'));

-- 기본값을 수사 도메인으로. (016 은 'general' 이었다)
alter table v2.meetings alter column kind set default 'interview';

comment on column v2.meetings.kind is
  'IEP 조사 종류: interrogation(신문)·witness(참고인)·victim(피해자)·interview(면담)·meeting(회의). 분석·코칭이 이 값으로 갈린다 (031)';

commit;
