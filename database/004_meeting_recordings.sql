-- ===================================================================
-- 004: 미팅당 다중 녹음 (녹음 목록 + 선택 분석)
--   - 녹음할 때마다 개별 저장·개별 전사 → 그중 선택분만 이어붙여 분석
--   - meeting_id 는 최종 제출(첨부) 전까지 NULL (draft)
-- ===================================================================
CREATE TABLE IF NOT EXISTS v2.meeting_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  meeting_id UUID REFERENCES v2.meetings(id),   -- 첨부 전 NULL
  label VARCHAR(100),
  storage_path TEXT,
  duration_seconds INTEGER,
  transcription TEXT,
  segments JSONB,
  selected BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_recordings_user ON v2.meeting_recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_recordings_meeting ON v2.meeting_recordings(meeting_id);

COMMIT;
