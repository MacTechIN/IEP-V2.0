-- 033 — 진술 분석(S4)이 findings 에 담는 종류를 넓힌다.
--
-- ── 왜 findings 를 재사용하나 ────────────────────────────────
--   018 의 v2.findings 는 (kind·severity·detail·refs·question) 모양이 그대로
--   진술 분석에 맞는다. 새 테이블을 만들면 화면·저장·이력이 두 벌이 된다.
--   대신 kind 의 허용값만 넓히고, **인용 대조를 DB 에도 건다.**
--
-- ── 인용 대조를 DB 에도 거는 이유 ───────────────────────────
--   서비스(statementAnalysis.ts)가 인용을 전사와 대조해 걸러도, 잘못된 경로로
--   INSERT 되면 근거 없는 findings 가 들어갈 수 있다. 018 이 INCONSISTENCY 에
--   refs≥2 를 DB 로 못박은 것과 같은 이유로, CONTRADICTION·UNANSWERED 도 못박는다.
--   **근거 없는 지적은 조사를 망친다** (§0).
--
-- 멱등: 리셋/재적용에서 여러 번 돌아도 같은 상태가 되게 drop-if-exists 후 add.

-- 1) kind 허용값을 넓힌다. 옛 법률 종류는 남긴다(이 스키마의 내력, 지우면 옛 행이 깨진다).
alter table v2.findings drop constraint if exists findings_kind_check;
alter table v2.findings add constraint findings_kind_check check (
  kind in (
    -- 진술 분석 (IEP S4)
    'CONTRADICTION',   -- 같은 조사 안에서 어긋나는 두 발언 (인용 2개)
    'UNANSWERED',      -- 물었는데 다른 답이 온 곳 (질문+답 인용)
    'UNVERIFIED',      -- 확인 가능한데 근거가 안 나온 주장 + 물어볼 질문
    'ATTITUDE_SHIFT',  -- 특정 주제에서 회피·화제 전환이 반복되는 지점
    -- 법률 분해 (내력 — LEP 에서 온 것)
    'GAP', 'INCONSISTENCY', 'ADVERSE_FACT', 'ASSUMPTION'
  )
);

-- 2) 진술 분석의 인용 대조를 DB 에 못박는다.
--    CONTRADICTION·UNANSWERED 는 refs(인용)가 **둘 이상**이어야 한다.
--    무엇과 무엇이 어긋나는지 못 가리키면 지적이 아니라 주장일 뿐이다.
alter table v2.findings drop constraint if exists findings_statement_needs_refs;
alter table v2.findings add constraint findings_statement_needs_refs check (
  kind not in ('CONTRADICTION', 'UNANSWERED') or jsonb_array_length(refs) >= 2
);

comment on constraint findings_statement_needs_refs on v2.findings is
  '진술 분석: 모순·미응답은 인용 2개 이상. 근거 없는 지적을 DB 에서 막는다 (§0).';
