-- ===================================================================
-- 003: V1식 분석 리포트 보강 (A안)
--   - analysis_results 에 V1 리포트 필드 추가 (요약/관심사/우려/액션/팔로업/대화지표/화자역할)
--   - 화자별 전사 세그먼트 테이블
-- 기존 컬럼(customer_needs/deal_signals/scores/sentiment/key_points)은 유지(대시보드 호환)
-- ===================================================================

ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS interests JSONB DEFAULT '[]';
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS concerns JSONB DEFAULT '[]';
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS action_items JSONB DEFAULT '[]';
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS follow_up_draft TEXT;
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS talk_metrics JSONB;
ALTER TABLE v2.analysis_results ADD COLUMN IF NOT EXISTS speaker_roles JSONB;

-- 화자별 전사 세그먼트
CREATE TABLE IF NOT EXISTS v2.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES v2.meetings(id),
  speaker_label VARCHAR(50),   -- 역할(영업대표/고객) 또는 화자 A/B
  speaker_id VARCHAR(50),      -- 음향 화자 식별자
  content TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  sort_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_id ON v2.transcript_segments(meeting_id);

COMMIT;
