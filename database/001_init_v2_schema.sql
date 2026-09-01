-- ===================================================================
-- MVP V2.0 데이터베이스 스키마 초기화
-- ===================================================================

-- 스키마 생성
CREATE SCHEMA IF NOT EXISTS v2;

-- UUID 확장
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================================================================
-- 1. Users (사용자)
-- ===================================================================
CREATE TABLE v2.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'sales_rep',
  department VARCHAR(255),
  monthly_target_krw BIGINT,
  phone VARCHAR(20),
  profile_image_url TEXT,
  bio TEXT,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  notification_preferences JSONB DEFAULT '{"analysisComplete": true, "importantSignal": true, "improvementSuggestion": true}',
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON v2.users(email);
CREATE INDEX idx_users_is_active ON v2.users(is_active);

-- ===================================================================
-- 2. Customers (고객)
-- ===================================================================
CREATE TABLE v2.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  company_name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),
  company_size VARCHAR(50),
  budget_min_krw BIGINT,
  budget_max_krw BIGINT,
  deal_status VARCHAR(50) DEFAULT 'new',
  estimated_closing_date DATE,
  actual_closing_date DATE,
  primary_contact_name VARCHAR(255),
  primary_contact_email VARCHAR(255),
  primary_contact_title VARCHAR(255),
  contacts JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_customers_user_id ON v2.customers(user_id);
CREATE INDEX idx_customers_deal_status ON v2.customers(deal_status);
CREATE INDEX idx_customers_created_at ON v2.customers(created_at DESC);

-- ===================================================================
-- 3. Meetings (미팅)
-- ===================================================================
CREATE TABLE v2.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  customer_id UUID NOT NULL REFERENCES v2.customers(id),
  title VARCHAR(255) NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER,
  attendees JSONB DEFAULT '[]',
  audio_url TEXT,
  audio_duration_seconds INTEGER,
  transcription TEXT,
  analysis_status VARCHAR(50) DEFAULT 'pending',
  analysis_progress INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_meetings_user_id ON v2.meetings(user_id);
CREATE INDEX idx_meetings_customer_id ON v2.meetings(customer_id);
CREATE INDEX idx_meetings_start_time ON v2.meetings(start_time DESC);
CREATE INDEX idx_meetings_analysis_status ON v2.meetings(analysis_status);

-- ===================================================================
-- 4. Analysis Results (분석 결과)
-- ===================================================================
CREATE TABLE v2.analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES v2.meetings(id),
  customer_needs JSONB NOT NULL DEFAULT '{"primary": "", "secondary": [], "budget": "", "timeline": "", "decisionMakers": 0, "confidence": 0.0}',
  deal_signals JSONB NOT NULL DEFAULT '{"signal": "neutral", "strength": 0.0, "closingProbability": 0.0, "competition": "", "nextSteps": ""}',
  scores JSONB NOT NULL DEFAULT '{"customerUnderstanding": 0, "problemSolving": 0, "proposalPersuasion": 0, "followUp": 0, "teamCollaboration": 0, "overall": 0}',
  sentiment VARCHAR(50),
  sentiment_score FLOAT,
  key_points TEXT[],
  action_items_extracted JSONB DEFAULT '[]',
  overall_confidence FLOAT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analysis_results_meeting_id ON v2.analysis_results(meeting_id);
CREATE INDEX idx_analysis_results_created_at ON v2.analysis_results(created_at DESC);

-- ===================================================================
-- 5. Action Items (액션 항목)
-- ===================================================================
CREATE TABLE v2.action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES v2.meetings(id),
  action_text VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(50) DEFAULT 'medium',
  due_date DATE NOT NULL,
  assigned_to_user_id UUID REFERENCES v2.users(id),
  status VARCHAR(50) DEFAULT 'pending',
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_rate INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_action_items_meeting_id ON v2.action_items(meeting_id);
CREATE INDEX idx_action_items_assigned_to ON v2.action_items(assigned_to_user_id);
CREATE INDEX idx_action_items_status ON v2.action_items(status);
CREATE INDEX idx_action_items_due_date ON v2.action_items(due_date);

-- ===================================================================
-- 6. Emails
-- ===================================================================
CREATE TABLE v2.emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES v2.meetings(id),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  recipient_email VARCHAR(255) NOT NULL,
  cc_emails TEXT[],
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  template_name VARCHAR(100),
  template_variables JSONB,
  status VARCHAR(50) DEFAULT 'draft',
  sent_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_emails_meeting_id ON v2.emails(meeting_id);
CREATE INDEX idx_emails_user_id ON v2.emails(user_id);
CREATE INDEX idx_emails_status ON v2.emails(status);

-- ===================================================================
-- 7. Learning Cases
-- ===================================================================
CREATE TABLE v2.learning_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  customer_name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),
  company_size VARCHAR(50),
  deal_amount_krw BIGINT,
  outcome VARCHAR(50) NOT NULL,
  duration_days INTEGER,
  strategy TEXT[],
  lessons_learned TEXT,
  similarity_features JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_learning_cases_user_id ON v2.learning_cases(user_id);
CREATE INDEX idx_learning_cases_outcome ON v2.learning_cases(outcome);
CREATE INDEX idx_learning_cases_created_at ON v2.learning_cases(created_at DESC);

-- ===================================================================
-- 8. User Scores
-- ===================================================================
CREATE TABLE v2.user_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  current_score INTEGER DEFAULT 0,
  weekly_score INTEGER DEFAULT 0,
  monthly_score INTEGER DEFAULT 0,
  score_components JSONB DEFAULT '{"customerUnderstanding": 0, "problemSolving": 0, "proposalPersuasion": 0, "followUp": 0, "teamCollaboration": 0}',
  metrics JSONB DEFAULT '{"meetingsThisWeek": 0, "actionCompletionRate": 0.0, "customerSatisfaction": 0.0}',
  weekly_rank INTEGER,
  monthly_rank INTEGER,
  week_start_date DATE,
  month_start_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_scores_user_id_week ON v2.user_scores(user_id, week_start_date);
CREATE INDEX idx_user_scores_weekly_rank ON v2.user_scores(weekly_rank);

-- ===================================================================
-- 9. Notifications
-- ===================================================================
CREATE TABLE v2.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  related_entity_type VARCHAR(50),
  related_entity_id UUID,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  channels JSONB DEFAULT '["in_app"]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notifications_user_id ON v2.notifications(user_id);
CREATE INDEX idx_notifications_is_read ON v2.notifications(is_read);
CREATE INDEX idx_notifications_created_at ON v2.notifications(created_at DESC);

-- ===================================================================
-- 10. Sessions
-- ===================================================================
CREATE TABLE v2.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  refresh_token VARCHAR(500) UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sessions_user_id ON v2.sessions(user_id);
CREATE INDEX idx_sessions_refresh_token ON v2.sessions(refresh_token);
CREATE INDEX idx_sessions_expires_at ON v2.sessions(expires_at);

-- ===================================================================
-- 뷰 생성
-- ===================================================================

-- 최근 미팅 대시보드
CREATE VIEW v2.vw_recent_meetings AS
SELECT
  m.id,
  m.title,
  u.name as user_name,
  c.company_name,
  m.start_time,
  ar.scores ->> 'overall' as overall_score,
  ar.deal_signals ->> 'signal' as deal_signal,
  m.analysis_status
FROM v2.meetings m
JOIN v2.users u ON m.user_id = u.id
JOIN v2.customers c ON m.customer_id = c.id
LEFT JOIN v2.analysis_results ar ON m.id = ar.meeting_id
WHERE m.deleted_at IS NULL
ORDER BY m.created_at DESC;

-- ===================================================================
-- 초기 데이터 (선택사항)
-- ===================================================================

-- 테스트 사용자. **비밀번호가 없다** — 해시는 아무도 모르는 난수를 해시한 값이다.
-- 예전에는 `password123` 해시가 박혀 있었다. 시드에 쓸 수 있는 비밀번호를 두면
-- 그게 그대로 운영에 남는다 (002 주석 참고).
INSERT INTO v2.users (email, name, password_hash, role, monthly_target_krw, is_verified)
VALUES (
  'kim@company.com',
  '김현진',
  '$2b$10$gU7jbtGsTDrJ1b8e1NHkB.IypX7Z8jgMg0l7xDKSpZoaypcqZqahC',
  'sales_rep',
  5000000,
  true
) ON CONFLICT (email) DO NOTHING;

-- 테스트 고객
INSERT INTO v2.customers (user_id, company_name, industry, company_size, budget_min_krw, budget_max_krw, deal_status)
SELECT
  id,
  'ABC Corp',
  'IT Solutions',
  'medium',
  5000000,
  10000000,
  'new'
FROM v2.users WHERE email = 'kim@company.com'
ON CONFLICT DO NOTHING;

COMMIT;
