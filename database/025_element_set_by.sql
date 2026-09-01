-- 025: 사람이 정한 요건 상태를 AI 가 덮지 못하게 한다
--
-- ── 왜 지금 필요한가 ─────────────────────────────────────────
--
-- `018` 까지 `legal_elements` 를 쓰는 곳은 **AI 분석 하나뿐**이었다.
-- 덮어써도 덮이는 것이 자기 자신뿐이라 문제가 없었다.
--
-- 이제 사람이 요건을 고칠 수 있게 하려는 참인데, `legalPersist` 의 upsert 는
-- **조건 없이 덮는다.** 그대로 두면 —
--
--   변호사가 「인과관계 = 충족」 이라고 판단해 손으로 바꾼다
--   → 다음 상담이 분석된다
--   → AI 가 「인과관계 = 일부」 라고 보면 **사람의 판단이 조용히 사라진다**
--
-- 변호사는 자기가 바꿔 놓은 것이 그대로 있다고 믿는다. 그게 제일 나쁘다.
--
-- ── 전에도 같은 사고가 있었다 ────────────────────────────────
--
-- `docs/ARCHITECTURE.md` — "`action_items_done` 은 사용자가 체크한 것이다.
-- **재요약이 건드리면 안 된다** — v1 이 같은 사고를 냈고 `0030` 으로 고쳤다."
--
-- 같은 실수를 요건에서 반복하지 않는다.
--
-- ── 어떻게 ───────────────────────────────────────────────────
--
-- `set_by` 가 `'human'` 인 행은 **AI 가 건드리지 않는다.**
-- 사람이 정한 것을 되돌리는 것도 사람만 할 수 있다 (`set_by` 를 `'ai'` 로 돌리면
-- 다음 분석부터 다시 AI 가 채운다).
--
-- **되돌리기**
--   alter table v2.legal_elements drop column set_by, drop column set_by_email, drop column set_at;

alter table v2.legal_elements
  add column if not exists set_by text not null default 'ai'
    check (set_by in ('ai', 'human')),
  add column if not exists set_by_email text,
  add column if not exists set_at timestamptz;

comment on column v2.legal_elements.set_by is
  '누가 이 상태를 정했나 (025). **human 이면 AI 가 덮지 않는다** — 사람의 판단이 조용히 사라지면 안 된다.';
comment on column v2.legal_elements.set_by_email is
  '사람이 정했다면 누가 (025). 계정이 지워져도 남는다 — 024 와 같은 이유.';
