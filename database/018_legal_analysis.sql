-- 018: 법률 분석을 담는 자리
--
-- 설계 문서는 018·019·020 셋으로 나눠 두었는데 하나로 합쳤다.
-- 어차피 함께 적용되고 서로를 참조한다 — 셋으로 나누면 번호만 늘고 얻는 것이 없다.
--
-- ── 무엇을 담나 ───────────────────────────────────────────────
--
--   element_templates   청구원인별 요건사실 **틀**. 시드로 셋을 넣는다
--   legal_elements      이 사건의 요건 충족 상태 (사건 단위, 상담을 거치며 채워진다)
--   legal_analyses      모델이 뭐라고 했는지 **원문 그대로** (상담 단위)
--   findings            누락·모순·불리한 사실 (상담 단위)
--   timeline_events     기준일 중심 시계열 (사건 단위)
--   evidence            증거와 입증 난이도 (사건 단위, **상태가 변한다**)
--
-- ── 왜 이렇게 나눴나 ──────────────────────────────────────────
--
-- **사건 단위와 상담 단위를 가른다.**
--   요건·타임라인·증거는 **상담을 거치며 쌓인다** — 2회 상담에서 나온 사실이
--   1회의 빈 요건을 채운다. 그래서 사건에 붙는다.
--   findings 와 분석 원문은 그 상담에서 나온 것이라 상담에 붙는다.
--
-- **`legal_analyses` 에 JSON 원문을 통째로 남긴다.**
--   정규화한 표만 두면 "모델이 실제로 뭐라고 했는지" 가 사라진다.
--   프롬프트를 고쳤을 때 전후를 비교할 수 없고, 잘못 뽑힌 것을 되짚을 수도 없다.
--   SEP 에서 배운 것이다 — **재지 못하면 고칠 수 없다** (014·015).
--
-- ── 요건 체크리스트에 대한 경고 ────────────────────────────────
--
--   **시드로 넣는 셋은 출발점이지 정답이 아니다.** 교과서적 요건사실을 적어 둔 것이고,
--   사건 유형·판례·특별법에 따라 달라진다. **변호사가 고치는 것을 전제로 표에 둔다** —
--   코드에 박아 두면 고치려면 배포를 해야 한다.
--
--   `is_builtin` 이 붙은 행은 우리가 넣은 것이고, 사용자가 고치면 `is_builtin=false` 로
--   내려간다. 다음 배포가 사용자의 수정을 덮지 않게 하려는 것이다.
--
-- **되돌리기**: 아래 표 여섯을 drop 한다 (참조 순서 주의 — element_statements 부터).

-- ─────────────────────────── 1. 요건사실 틀

create table if not exists v2.element_templates (
  id          uuid primary key default gen_random_uuid(),
  -- null 이면 전체 공용(우리가 넣은 것). 값이 있으면 그 사무소만의 것.
  user_id     uuid references v2.users(id) on delete cascade,
  cause       text not null,
  element     text not null,
  sort_order  integer not null default 0,
  hint        text,
  is_builtin  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, cause, element)
);

comment on table v2.element_templates is
  '청구원인별 요건사실 틀 (018). **출발점이지 정답이 아니다** — 변호사가 고치는 것을 전제로 표에 둔다.';

create index if not exists idx_element_templates_cause on v2.element_templates (cause, sort_order);

-- ─────────────────────────── 2. 이 사건의 요건 충족 상태

create table if not exists v2.legal_elements (
  id          uuid primary key default gen_random_uuid(),
  matter_id   uuid not null references v2.matters(id) on delete cascade,
  cause       text not null,
  element     text not null,
  sort_order  integer not null default 0,
  status      text not null default 'MISSING'
              check (status in ('SATISFIED', 'PARTIAL', 'MISSING', 'CONTESTED')),
  note        text,
  -- 어느 상담에서 이 상태가 된 것인가. 되짚을 수 있어야 한다.
  updated_by_meeting uuid references v2.meetings(id) on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (matter_id, cause, element)
);

comment on table v2.legal_elements is
  '이 사건의 요건 충족 상태 (018). **상담을 거치며 쌓인다** — 2회 상담이 1회의 빈 요건을 채운다.';
comment on column v2.legal_elements.status is
  'MISSING 인 것이 곧 누락이다. 모델에게 "빠진 게 뭐냐" 고 묻는 것보다 계산이 확실하다.';

create index if not exists idx_legal_elements_matter on v2.legal_elements (matter_id, sort_order);
-- **아직 안 채워진 요건만** 빨리 찾는다. 이게 다음 상담에서 물어야 할 것이다.
create index if not exists idx_legal_elements_missing
  on v2.legal_elements (matter_id) where status in ('MISSING', 'PARTIAL');

-- ─────────────────────────── 3. 모델이 뭐라고 했는지 (원문)

create table if not exists v2.legal_analyses (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null unique references v2.meetings(id) on delete cascade,
  matter_id   uuid references v2.matters(id) on delete set null,
  -- legalAnalysis.ts 의 LegalAnalysis 를 그대로. 정규화한 표가 있어도 원문을 버리지 않는다.
  result      jsonb not null,
  model       text,
  persona_rev text,            -- 어느 페르소나로 뽑았나. 프롬프트를 고치면 전후를 비교해야 한다
  created_at  timestamptz not null default now()
);

comment on table v2.legal_analyses is
  '법률 분석 원문 (018). 정규화한 표만 두면 "모델이 실제로 뭐라고 했는지" 가 사라진다 — 재지 못하면 고칠 수 없다.';

create index if not exists idx_legal_analyses_matter on v2.legal_analyses (matter_id, created_at desc);

-- ─────────────────────────── 4. 누락·모순·불리한 사실

create table if not exists v2.findings (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references v2.meetings(id) on delete cascade,
  matter_id   uuid references v2.matters(id) on delete set null,
  kind        text not null check (kind in ('GAP', 'INCONSISTENCY', 'ADVERSE_FACT', 'ASSUMPTION')),
  severity    text not null default 'MEDIUM' check (severity in ('LOW', 'MEDIUM', 'HIGH')),
  detail      text not null,
  -- 모순은 **반드시 둘 이상**을 가리킨다. 무엇과 무엇이 어긋나는지 못 가리키면 주장일 뿐이다.
  refs        jsonb not null default '[]'::jsonb,
  question    text,
  -- 변호사가 확인하고 넘긴 것. **지우지 않는다** — 왜 넘겼는지가 나중에 필요하다.
  resolved    boolean not null default false,
  resolved_note text,
  created_at  timestamptz not null default now(),
  constraint findings_inconsistency_needs_refs
    check (kind <> 'INCONSISTENCY' or jsonb_array_length(refs) >= 2)
);

comment on table v2.findings is
  '누락·모순·불리한 사실 (018). **없으면 없다고만 적는다** — 억지로 채우면 거짓 경보가 된다.';

create index if not exists idx_findings_meeting on v2.findings (meeting_id);
create index if not exists idx_findings_open
  on v2.findings (matter_id, severity) where not resolved;

-- ─────────────────────────── 5. 시계열

create table if not exists v2.timeline_events (
  id            uuid primary key default gen_random_uuid(),
  matter_id     uuid not null references v2.matters(id) on delete cascade,
  meeting_id    uuid references v2.meetings(id) on delete set null,
  occurred_on   date,
  -- **날짜가 불명확한 것을 불명확하다고 적는다.** 추정을 확정으로 그리면 그게 사고다 (017 과 같은 원칙).
  precision     text not null default 'UNKNOWN'
                check (precision in ('EXACT', 'MONTH', 'YEAR', 'UNKNOWN')),
  what          text not null,
  legal_meaning text,
  actors        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table v2.timeline_events is
  '기준일 중심 시계열 (018). precision 이 UNKNOWN 인 것을 확정처럼 그리지 않는다.';

-- 날짜 없는 것도 보여 줘야 한다(맨 뒤로). nulls last 로 정렬한다.
create index if not exists idx_timeline_matter on v2.timeline_events (matter_id, occurred_on nulls last);

-- ─────────────────────────── 6. 증거

create table if not exists v2.evidence (
  id          uuid primary key default gen_random_uuid(),
  matter_id   uuid not null references v2.matters(id) on delete cascade,
  meeting_id  uuid references v2.meetings(id) on delete set null,
  kind        text not null,                -- 계약서 · 문자 · 이체내역 · 증인 …
  what        text not null,
  /**
   * **"있다" 와 "가져올 수 있다" 는 다르다.** 그 차이가 전략을 바꾼다.
   *   SECURED       확보됨
   *   PROMISED      의뢰인이 주기로 함
   *   UNCONFIRMED   있다고 하는데 확인 안 됨
   *   NON_EXISTENT  없다
   */
  status      text not null default 'UNCONFIRMED'
              check (status in ('SECURED', 'PROMISED', 'UNCONFIRMED', 'NON_EXISTENT')),
  holder      text,                          -- 의뢰인 · 상대방 · 제3자 · 불명
  difficulty  integer check (difficulty between 1 and 5),
  proves      text,                          -- 무엇을 입증하나
  note        text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table v2.evidence is
  '증거와 입증 난이도 (018). **상태가 변한다** — 확보하면 SECURED 로 올린다.';
comment on column v2.evidence.difficulty is
  '확보 난이도 1~5. 상대방이 가진 문서는 있어도 못 쓸 수 있고, 그 사실이 전략을 바꾼다.';

create index if not exists idx_evidence_matter on v2.evidence (matter_id, status);

-- ─────────────────────────── 7. 시드 — 청구원인 셋
--
-- **교과서적 요건사실이다. 출발점이지 정답이 아니다.**
-- 사건 유형·판례·특별법에 따라 달라지므로 변호사가 확인하고 고쳐야 한다.
-- `user_id is null` = 전체 공용, `is_builtin = true` = 우리가 넣은 것.

insert into v2.element_templates (user_id, cause, element, sort_order, hint, is_builtin) values
  -- 채무불이행 (민법 제390조) — 손해배상
  (null, '채무불이행', '채무의 존재',      1, '계약이 성립했는가. 계약서·약정 내용', true),
  (null, '채무불이행', '이행기의 도래',    2, '변제기·이행기가 지났는가', true),
  (null, '채무불이행', '채무의 불이행',    3, '이행지체 · 이행불능 · 불완전이행 중 무엇인가', true),
  (null, '채무불이행', '채무자의 귀책사유', 4, '고의·과실. 실무상 채무자가 무과실을 입증한다', true),
  (null, '채무불이행', '손해의 발생',      5, '어떤 손해가 얼마나', true),
  (null, '채무불이행', '인과관계',         6, '불이행과 손해 사이의 상당인과관계', true),
  -- 불법행위 (민법 제750조)
  (null, '불법행위', '가해행위',           1, '누가 무엇을 했는가', true),
  (null, '불법행위', '위법성',             2, '법질서에 반하는가. 정당행위·정당방위 등 조각사유', true),
  (null, '불법행위', '고의 또는 과실',     3, '주의의무 위반의 내용', true),
  (null, '불법행위', '손해의 발생',        4, '적극손해 · 소극손해 · 위자료', true),
  (null, '불법행위', '인과관계',           5, '가해행위와 손해 사이', true),
  (null, '불법행위', '책임능력',           6, '미성년·심신상실 등이 문제되는 경우에만', true),
  -- 부당이득 (민법 제741조)
  (null, '부당이득', '수익',               1, '타인의 재산·노무로 이익을 얻었는가', true),
  (null, '부당이득', '손해',               2, '그로 인해 타인에게 손해가 있는가', true),
  (null, '부당이득', '인과관계',           3, '이익과 손해 사이', true),
  (null, '부당이득', '법률상 원인의 없음',  4, '**이것이 핵심 다툼이 되는 경우가 많다**', true)
on conflict (user_id, cause, element) do nothing;

/**
 * 사건에 요건 체크리스트를 깔아 준다. **이미 있는 것은 건드리지 않는다** —
 * 변호사가 고쳐 둔 상태를 덮으면 안 된다.
 */
create or replace function v2.seed_legal_elements(p_matter uuid, p_cause text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into v2.legal_elements (matter_id, cause, element, sort_order)
  select p_matter, t.cause, t.element, t.sort_order
    from v2.element_templates t
   where t.cause = p_cause and t.user_id is null
  on conflict (matter_id, cause, element) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function v2.seed_legal_elements(uuid, text) is
  '사건에 요건 체크리스트를 깐다 (018). 이미 있는 것은 건드리지 않는다 — 사람이 고친 상태를 덮지 않는다.';
