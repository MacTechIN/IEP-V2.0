-- ===================================================================
-- 005: 심리 인사이트 + 코칭 + 5축 스코어카드 (B안)
-- ===================================================================
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS psych_insights JSONB;
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS coaching JSONB;
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS scorecard JSONB;

COMMIT;
