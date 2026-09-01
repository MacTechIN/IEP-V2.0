-- 029: 서면(書面) 생성
--
-- ── 무엇을 만드는가 ──────────────────────────────────────────
--
-- 상담 분석에서 나온 것으로 **소장·내용증명 같은 서면 초안**을 만든다.
-- 첫 서식은 소장이지만, **소장 전용 표를 만들지 않는다** — 서식은 계속 는다.
--
-- ── 왜 표가 하나인가 ─────────────────────────────────────────
--
-- 서식마다 표를 만들면 서식을 더할 때마다 마이그레이션이 필요하고,
-- 「이 사건의 서면 전부」 를 묻는 질의가 서식 수만큼 늘어난다.
-- 서식이 다른 것은 **내용**이지 **저장 구조**가 아니다 —
-- 어느 사건의 · 어느 상담에서 · 누가 · 무엇을 만들었나는 전부 같다.
--
-- 그래서 서식별 차이는 `kind` 와 `result`(jsonb)에 담고,
-- **표는 하나로 둔다.** 새 서식은 코드(`services/documents/`)만 더하면 된다.
--
-- ── 왜 `input` 을 통째로 남기는가 ────────────────────────────
--
-- 서면은 **법원에 나가는 문서**다. 나중에 「이 소장이 왜 이렇게 나왔나」 를
-- 되짚을 수 없으면 고칠 수도 없다. 생성 당시의 사건 상태(당사자·요건·증거·소가)를
-- 통째로 박제한다 — 그 뒤에 사건이 바뀌어도 **그때 무엇을 보고 썼는지**가 남는다.
--
-- `legal_analyses.result` 를 원문 그대로 남긴 것과 같은 이유다 (018).
--
-- ── 금액은 여기 없다 ────────────────────────────────────────
--
-- 인지액·송달료는 `input.costs` 에 계산 결과가 함께 박제되지만,
-- **계산 자체는 코드가 한다** (`services/documents/costs.ts`).
-- 모델에게 시키지 않는다 — 지어낸 인지액이 붙은 소장은 각하될 수 있다.
--
-- **되돌리기**
--   drop table v2.legal_documents;

create table if not exists v2.legal_documents (
  id          uuid primary key default gen_random_uuid(),
  matter_id   uuid not null references v2.matters(id) on delete cascade,
  -- 어느 상담에서 만들었나. **상담이 지워져도 서면은 남는다** — 법원에 나간 문서일 수 있다.
  meeting_id  uuid references v2.meetings(id) on delete set null,

  -- 서식 종류. **CHECK 로 묶지 않는다** — 서식을 더할 때마다 마이그레이션을 내야 한다.
  -- 무엇이 유효한지는 `services/documents/` 의 등록부가 안다.
  kind        text not null,
  title       text not null,

  status      text not null default 'draft'
              check (status in ('draft', 'final', 'filed')),

  /** 생성 당시의 사건 상태를 통째로. 되짚기와 재현에 쓴다. */
  input       jsonb not null default '{}',
  /** 모델이 낸 구조화 결과. 서식마다 모양이 다르다. */
  result      jsonb not null default '{}',
  /** 사람이 읽고 고치는 본문. **모델 출력이 아니라 이것이 문서다.** */
  body        text,

  model       text,
  persona_rev text,

  -- 누가 만들었나. **이메일이 진짜 기록이다** — 계정이 지워져도 남는다 (024 와 같은 이유).
  created_by       uuid references v2.users(id) on delete set null,
  created_by_email text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table v2.legal_documents is
  '서면 초안 (029). 서식별 표를 만들지 않는다 — 다른 것은 내용이지 저장 구조가 아니다.';
comment on column v2.legal_documents.input is
  '생성 당시의 사건 상태를 통째로 (029). 나중에 「왜 이렇게 나왔나」 를 되짚을 수 없으면 고칠 수도 없다.';
comment on column v2.legal_documents.body is
  '사람이 읽고 고치는 본문. **모델 출력이 아니라 이것이 문서다** — 변호사가 고친 것이 최종이다.';
comment on column v2.legal_documents.kind is
  '서식 종류 (029). CHECK 로 묶지 않는다 — 서식을 더할 때마다 마이그레이션을 내야 하므로. 등록부는 코드에 있다.';

create index if not exists idx_legal_documents_matter
  on v2.legal_documents (matter_id, created_at desc);
create index if not exists idx_legal_documents_meeting
  on v2.legal_documents (meeting_id) where meeting_id is not null;
