-- 006: 분석이 왜 실패했는지 남긴다 (C-5-1)
--
-- 왜 필요한가
--   지금은 실패하면 `analysis_status = 'failed'` 만 쓴다. **원인이 아무 데도 없다.**
--   로그는 컨테이너를 재생성하면 사라지고, 사용자 화면에는 "실패" 세 글자만 남는다.
--   무엇을 고쳐야 하는지 알 수 없으니 사용자는 같은 파일로 재시도만 반복한다.
--
--   v1 이 정확히 이 문제를 겪었고(진단 F-2), 원인·중단 지점 두 가지를 저장해 해결했다.
--   Workflow 로 옮기면 단계가 명확해지므로 중단 지점이 저절로 의미를 갖는다.
--
--   analysis_started_at 은 중복 실행 판단에도 쓴다 — status 로 판단하면
--   사용자가 화면에서 초기화한 순간 가드가 뚫린다(v1 F-1 에서 실제로 겪었다).

alter table v2.meetings
  add column if not exists analysis_error text,
  add column if not exists analysis_stage text,
  add column if not exists analysis_started_at timestamptz;

comment on column v2.meetings.analysis_error is
  '분석 실패 원인(사용자에게 보여줄 문장). 성공하면 null 로 되돌린다.';
comment on column v2.meetings.analysis_stage is
  '마지막으로 진입한 단계. 실패 시 어디서 멈췄는지 알려준다.';
comment on column v2.meetings.analysis_started_at is
  '분석 시작 시각. 중복 실행 차단과 경과 시간 표시에 쓴다.';

COMMIT;
