-- 016: 사건(Matter)과 미팅 종류 — LEP 의 첫 마이그레이션
--
-- 001~015 는 SEP 에서 그대로 이어받은 스키마다. 여기서부터가 LEP 다.
--
-- ── 두 가지를 넣는다 ──────────────────────────────────────────────
--
-- 1. `meetings.kind` — **이게 없으면 분석이 무엇을 할지 모른다.**
--
--    모든 미팅이 사건 상담은 아니다. 변호사의 하루에는 사건과 무관한 자리가 섞여 있다 —
--    수임 전 상담, 자문 문의, 소개·네트워킹, 사무소 내부 회의, 거래처 미팅.
--
--    **일반 미팅에 법률 분석을 걸면 요건사실이 전부 MISSING 으로 나온다.**
--    아무 문제 없는 대화에 대고 "빠진 것 투성이" 라고 외치는 셈이고,
--    SEP 에서 두 번 밟은 거짓 경보와 같은 모양이다 (2026-08-20 · 08-24).
--
--      legal    상담(법률)   — 사실/주장/요건 분해 · 누락·모순 · 타임라인 · 증거
--      business 수임 상담    — SEP 의 영업 분석 그대로. 수임을 따내는 것은 영업이다
--      general  일반         — 요약·핵심·후속 조치만. 점수도 요건도 없다
--
--    **기본값은 `general` 이다.** 법률 분석을 잘못 거는 쪽이 그 반대보다 나쁘다 —
--    일반으로 돌린 상담은 나중에 다시 돌리면 되지만, 일반 대화에 요건 누락을 외치면
--    **다음부터 아무도 그 화면을 안 본다.**
--
-- 2. `matters` · `adverse_parties` — 사건과 상대방.
--
--    **`meetings.matter_id` 는 nullable 이다.** 사건 없는 미팅이 정상이고,
--    `customer_id`(의뢰인)조차 없는 미팅도 정상이다(내부 회의).
--
--    `customers` 를 `clients` 로 이름 바꾸지 않았다 — 서비스·라우트·화면이 전부 그 이름을 쓴다.
--    이름과 뜻이 어긋나는 것은 알고 있고, 그 값보다 검증된 코드의 안정성이 크다고 봤다.
--
-- **되돌리기**
--   drop table v2.adverse_parties;
--   alter table v2.meetings drop column matter_id;
--   drop table v2.matters;
--   alter table v2.meetings drop column kind;

-- ─────────────────────────── 1. 미팅 종류

alter table v2.meetings
  add column if not exists kind text not null default 'general';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meetings_kind_check'
  ) then
    alter table v2.meetings
      add constraint meetings_kind_check check (kind in ('legal', 'business', 'general'));
  end if;
end $$;

comment on column v2.meetings.kind is
  '분석 방식을 정한다 (016). legal=법률 상담 · business=수임 상담 · general=일반. 기본 general — 잘못 걸면 거짓 경보가 된다.';

-- 종류별로 훑는 질의가 기본이다 (대시보드·재분석 대상 고르기).
create index if not exists idx_meetings_kind on v2.meetings (user_id, kind, created_at desc);

-- ─────────────────────────── 1.5 의뢰인 없는 미팅도 정상이다
--
-- 001 에서 `meetings.customer_id` 가 NOT NULL 이었다. SEP 에서는 맞다 —
-- 영업 미팅에는 항상 고객사가 있다.
--
-- **LEP 에서는 틀리다.** 사무소 내부 회의, 거래처 미팅, 아직 의뢰인이 아닌 사람과의
-- 첫 접촉에는 의뢰인이 없다. 검증 SQL 이 이걸 잡았다 —
-- 설계 문서에 "의뢰인 없는 미팅도 정상" 이라고 적어 놓고 스키마는 막고 있었다.
--
-- **넓히는 변경이라 기존 행에는 영향이 없다.**

alter table v2.meetings alter column customer_id drop not null;

comment on column v2.meetings.customer_id is
  '의뢰인. **없어도 정상이다** (016) — 내부 회의·거래처 미팅에는 의뢰인이 없다.';

-- ─────────────────────────── 2. 사건

create table if not exists v2.matters (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references v2.users(id) on delete cascade,
  -- 의뢰인. `customers` 를 의뢰인 표로 쓴다 (위 주석 참고).
  client_id     uuid references v2.customers(id) on delete set null,

  title         text not null,
  -- 사무소 내부 사건번호. 법원 사건번호와 다르다 — 둘 다 필요하다.
  file_no       text,
  court_case_no text,

  matter_type   text,                    -- 민사·형사·가사·행정·자문 …
  cause         text,                    -- 청구원인 (채무불이행·불법행위 …). 요건 체크리스트의 열쇠다
  court         text,                    -- 관할

  status        text not null default 'open'
                check (status in ('open', 'closed', 'archived')),
  opened_on     date,
  closed_on     date,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table v2.matters is '사건 (016). 미팅은 사건에 붙을 수도, 안 붙을 수도 있다.';
comment on column v2.matters.cause is
  '청구원인. 어떤 요건사실 체크리스트를 쓸지 정하는 값이다 (018 에서 쓴다).';

create index if not exists idx_matters_user on v2.matters (user_id, status, updated_at desc);
create index if not exists idx_matters_client on v2.matters (client_id) where client_id is not null;

-- **미팅은 사건에 붙을 수도, 안 붙을 수도 있다.** 사건을 지워도 미팅과 녹음은 남는다.
alter table v2.meetings
  add column if not exists matter_id uuid references v2.matters(id) on delete set null;

create index if not exists idx_meetings_matter
  on v2.meetings (matter_id, start_time desc) where matter_id is not null;

-- ─────────────────────────── 3. 상대방 (이해충돌 검사의 재료)

create table if not exists v2.adverse_parties (
  id          uuid primary key default gen_random_uuid(),
  matter_id   uuid not null references v2.matters(id) on delete cascade,
  name        text not null,
  -- 표기가 흔들린다 — `주식회사 가나` · `㈜가나` · `가나(주)`.
  -- 대조는 **이 정규화된 값**으로 한다. 원문은 `name` 에 그대로 둔다.
  name_norm   text not null,
  role        text,                       -- 피고 · 원고 · 상대방 · 이해관계인
  note        text,
  created_at  timestamptz not null default now()
);

comment on table v2.adverse_parties is
  '사건 상대방 (016). 이해충돌 검사에 쓴다 — 새 의뢰인이 기존 사건의 상대방인지 본다.';
comment on column v2.adverse_parties.name_norm is
  '대조용 정규화 이름. 표기 흔들림(주식회사/㈜/공백)을 없앤 값.';

create index if not exists idx_adverse_matter on v2.adverse_parties (matter_id);
-- 이해충돌 검사는 이 이름으로 훑는다. 사건을 넘나들며 찾으므로 이름 단독 인덱스가 필요하다.
create index if not exists idx_adverse_norm on v2.adverse_parties (name_norm);

-- 의뢰인 쪽도 같은 방식으로 대조할 수 있어야 한다.
alter table v2.customers
  add column if not exists name_norm text;

comment on column v2.customers.name_norm is
  '대조용 정규화 이름 (016). 이해충돌 검사에서 상대방 이름과 맞춰 본다.';

create index if not exists idx_customers_norm on v2.customers (name_norm) where name_norm is not null;

-- **자동으로 막지 않는다.** 이 표들은 "의심되는 것을 보여 주기" 위한 재료일 뿐이고,
-- 수임 여부는 사람이 정한다 (CLAUDE.md — 자동으로 지우는 청소기를 만들지 않는다).
