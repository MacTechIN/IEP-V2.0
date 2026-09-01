-- 021: 비닉권 · 접근 감사 · 최소 노출
--
-- 설계 문서(§3.4)에서 **"나머지 셋의 전제"** 라고 적어 둔 것이다.
-- SEP 에서 "기록이 먼저" 였던 자리에, 여기서는 **보호가 먼저**다 —
-- 유출의 대가가 다르기 때문이다. 영업 정보가 새면 손해지만,
-- 상담 내용이 새면 **회복 불가능한 법적 손실**이 된다.
--
-- ── 무엇을 하고 무엇을 하지 않나 ──────────────────────────────
--
-- **저장된 전사문은 가리지 않는다.** 그것은 증거다 — 마스킹해 두면 나중에
-- "의뢰인이 실제로 뭐라고 했나" 를 되짚을 수 없다.
-- 비식별화는 **밖으로 내보낼 때**만 한다(`lib/pii.ts`, OpenAI 로 가는 프롬프트).
-- 저장은 이 마이그레이션의 **접근 통제와 감사**로 지킨다.
--
-- ── 세 가지 ───────────────────────────────────────────────────
--
-- 1. `privileged` — 비닉권 표시. **법률 상담은 기본이 true 다.**
--    내보내기·인쇄에 그 표시가 자동으로 박히게 하려는 것이다.
--
-- 2. `access_log` — **누가 언제 무엇을 열었는지.**
--    증거개시 다툼에서 "이 기록은 통제된 범위에서만 열람됐다" 를 말할 수 있어야 한다.
--    남기지 않으면 그 주장을 할 근거가 없다.
--
-- 3. `pii_masks` — 내보낼 때 가린 값의 대응표. **본문과 분리 보관한다** —
--    같은 곳에 두면 가린 의미가 없다.
--
-- ── 최소 노출은 코드에 있다 ───────────────────────────────────
--
--    SEP 는 관리자가 전체를 본다. **법률사무소에서는 그것이 위험이다.**
--    `kind='legal'` 인 미팅과 사건은 **담당자만** 본다 — 관리자 우회를 뺐다
--    (`services/meetings.ts`·`routes/*`). 일반·수임 미팅은 SEP 동작 그대로다.
--
-- **되돌리기**
--   drop table v2.pii_masks;  drop table v2.access_log;
--   alter table v2.meetings drop column privileged;
--   alter table v2.matters  drop column privileged;

-- ─────────────────────────── 1. 비닉권 표시

alter table v2.meetings add column if not exists privileged boolean not null default false;
alter table v2.matters  add column if not exists privileged boolean not null default true;

comment on column v2.meetings.privileged is
  '비닉권 대상 (021). 법률 상담은 기본이 true — 내보내기·인쇄에 표시가 자동으로 박힌다.';
comment on column v2.matters.privileged is
  '사건은 기본이 비닉권 대상이다 (021).';

-- **이미 있는 법률 상담을 소급해서 표시한다.** 앞으로 만들어지는 것은 코드가 정한다.
update v2.meetings set privileged = true where kind = 'legal' and privileged = false;

-- ─────────────────────────── 2. 접근 감사

create table if not exists v2.access_log (
  id          bigserial primary key,
  user_id     uuid references v2.users(id) on delete set null,
  -- **사용자를 지워도 기록은 남는다.** 감사 기록이 사라지면 감사가 아니다.
  user_email  text,
  action      text not null,        -- view · export · print · analyze · delete
  target      text not null,        -- meeting · matter · transcript · legal · recording
  target_id   uuid,
  matter_id   uuid,                 -- 사건 단위로 모아 보기 위해. FK 를 걸지 않는다(사건이 지워져도 남아야 한다)
  detail      jsonb,
  ip          text,
  at          timestamptz not null default now()
);

comment on table v2.access_log is
  '누가 언제 무엇을 열었나 (021). **증거개시 다툼에서 이 기록이 방패다** — 없으면 통제됐다는 주장을 할 근거가 없다.';
comment on column v2.access_log.user_email is
  '사용자를 지워도 남는다. 감사 기록이 사라지면 감사가 아니다.';

create index if not exists idx_access_log_at on v2.access_log (at desc);
create index if not exists idx_access_log_matter on v2.access_log (matter_id, at desc) where matter_id is not null;
create index if not exists idx_access_log_user on v2.access_log (user_id, at desc);

-- ─────────────────────────── 3. 비식별화 대응표 (본문과 분리)

create table if not exists v2.pii_masks (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references v2.meetings(id) on delete cascade,
  kind        text not null,        -- RRN · PHONE · CARD · ACCOUNT · EMAIL · BIZNO
  token       text not null,        -- [RRN_1]
  original    text not null,
  created_at  timestamptz not null default now(),
  unique (meeting_id, token)
);

comment on table v2.pii_masks is
  '내보낼 때 가린 값의 대응표 (021). **본문과 분리 보관한다** — 같은 곳에 두면 가린 의미가 없다.';

create index if not exists idx_pii_masks_meeting on v2.pii_masks (meeting_id);
