-- 015: 실시간 코칭 판정을 남긴다
--
-- 왜 필요한가
--   지금 코칭은 25초마다 판정을 내고 **화면에 한 번 띄우고 사라진다.**
--   클립도 전사문도 판정도 응답으로 나가고 끝이다(`services/risk.ts` 머리주석).
--   오디오를 안 남기는 것은 옳았다. 그런데 **판정까지 함께 사라지는 것은 부작용**이다.
--
--   그래서 지금 답할 수 없는 것들:
--     · 어제 회의에서 주의가 몇 번 떴나? 그중 몇 개가 맞았나?
--     · 프롬프트를 고쳤는데 나아졌나?
--     · 위험 2연속 규칙이 오탐을 줄이고 있나, 진짜 위험을 놓치고 있나?
--
--   **재지 못하면 고칠 수 없고, 고칠 수 없으면 우리 알고리즘이 아니다.**
--   계획: `docs/2026-08-24-live-coaching-algorithm-plan.md`
--
-- 동의
--   전사문 보관은 2026-08-24 에 정해졌고, **동의문을 먼저 고쳤다**(v2.16.0).
--   오디오 조각은 여전히 저장하지 않는다 — 전사문과 신호값이면 충분하고 오디오는 위험만 늘린다.
--
-- **`level` 과 `level_shown` 을 따로 두는 것이 이 표의 요점이다.**
--   모델이 위험이라 해도 첫 번째는 주의로 낮춘다(비대칭 히스테리시스).
--   그 완충이 실제로 도움이 되는지 재려면 **"모델은 뭐라 했나" 와 "사람은 뭘 봤나" 가 둘 다** 있어야 한다.
--   하나만 남기면 규칙을 평가할 수 없다.
--
-- **`session_id` 로 먼저 쌓고 미팅은 나중에 붙인다.**
--   코칭은 미팅이 만들어지기 전에 돈다 — 녹음 구간이 `meeting_id` 없이 먼저 올라가는 것과 같다(2.10.0).
--   미팅을 만들지 않고 그만두는 회의도 있으므로 `meeting_id` 는 null 을 허용한다.
--
-- **되돌리기**: `drop table v2.coaching_events;` — 다른 표를 건드리지 않는다.

create table if not exists v2.coaching_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references v2.users(id) on delete cascade,

  -- 녹음 한 건을 묶는 값. 브라우저가 녹음 시작 때 만든다(IndexedDB 백업과 같은 값).
  session_id   text not null,
  -- 미팅을 만들 때 채운다. 미팅이 지워지면 판정은 남기고 연결만 끊는다 —
  -- 알고리즘을 개선할 자료는 미팅과 별개로 값어치가 있다.
  meeting_id   uuid references v2.meetings(id) on delete set null,

  at_ms        integer not null,              -- 녹음 시작 기준 경과
  level        text    not null,              -- 모델이 준 원본 등급
  level_shown  text    not null,              -- 화면에 실제로 뜬 등급 (완충 적용 후)
  danger_streak integer not null default 0,   -- 그 시점의 위험 연속 횟수

  reason       text,
  script       text,
  action       text,
  transcript   text,                          -- 그 주기 전사문 (오디오는 저장하지 않는다)
  signals      jsonb,                         -- 코드로 계산한 신호값. 2단계에서 채운다

  -- 유일한 정답표. 이것이 없으면 보정도 개인화도 영원히 불가능하다.
  feedback     text check (feedback in ('helpful', 'missed')),
  feedback_at  timestamptz,

  created_at   timestamptz not null default now()
);

comment on table v2.coaching_events is
  '실시간 코칭 판정 기록 (015). 오디오는 저장하지 않는다 — 전사문과 신호값만.';
comment on column v2.coaching_events.level is
  '모델이 준 원본 등급. level_shown 과 비교해야 완충 규칙을 평가할 수 있다.';
comment on column v2.coaching_events.level_shown is
  '화면에 실제로 뜬 등급. 사용자가 본 것은 이것이다.';

-- 한 사람의 최근 것을 보는 질의가 기본이다 (주간 집계·오탐률).
create index if not exists idx_coaching_user_recent
  on v2.coaching_events (user_id, created_at desc);

-- 미팅 상세의 코칭 타임라인. **부분 인덱스다** — 붙지 않은 행이 대부분일 수 있다.
create index if not exists idx_coaching_meeting
  on v2.coaching_events (meeting_id, at_ms)
  where meeting_id is not null;

-- 녹음이 끝난 뒤 session_id 로 미팅에 붙일 때 쓴다.
create index if not exists idx_coaching_session
  on v2.coaching_events (session_id)
  where meeting_id is null;

-- 피드백이 달린 것만 빨리 찾기 위한 부분 인덱스. 정답표는 소수다.
create index if not exists idx_coaching_feedback
  on v2.coaching_events (user_id, feedback)
  where feedback is not null;
