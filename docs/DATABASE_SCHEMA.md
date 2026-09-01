# 데이터베이스 스키마 (Database Schema)

**버전:** 1.0  
**최종 수정:** 2026-08-06  
**데이터베이스:** PostgreSQL 14+  
**스키마 네임스페이스:** `v2` (V1과 분리)  

---

## 📊 개요

V2.0은 기존 V1 데이터베이스와 완전히 분리된 `v2` 스키마를 사용합니다.

```
PostgreSQL Database
├── public (V1 레거시)
│   ├── meetings
│   ├── users
│   └── ...
└── v2 (V2.0 신규)
    ├── users
    ├── customers
    ├── meetings
    ├── analysis_results
    ├── action_items
    ├── emails
    ├── notifications
    ├── learning_cases
    └── user_scores
```

**마이그레이션 전략:**
1. V1 데이터는 `public` 스키마 유지
2. V2 데이터는 `v2` 스키마에서 새로 생성
3. 필요시 뷰(VIEW)를 통해 V1 데이터 연동

---

## 👤 사용자 (users)

```sql
CREATE TABLE v2.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'sales_rep',  -- sales_rep, manager, admin
  department VARCHAR(255),
  
  -- 성과 목표
  monthly_target_krw BIGINT,  -- 월간 목표 (원)
  
  -- 프로필
  phone VARCHAR(20),
  profile_image_url TEXT,
  bio TEXT,
  
  -- 상태
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  
  -- 설정
  notification_preferences JSONB DEFAULT '{
    "analysisComplete": true,
    "importantSignal": true,
    "improvementSuggestion": true
  }',
  
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON v2.users(email);
CREATE INDEX idx_users_is_active ON v2.users(is_active);
```

---

## 👥 고객 (customers)

```sql
CREATE TABLE v2.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  company_name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),  -- IT Solutions, Finance, Healthcare, etc.
  company_size VARCHAR(50),  -- small, medium, large, enterprise
  
  -- 예산 정보
  budget_min_krw BIGINT,
  budget_max_krw BIGINT,
  
  -- 거래 상태
  deal_status VARCHAR(50) DEFAULT 'new',  -- new, in_progress, won, lost
  estimated_closing_date DATE,
  actual_closing_date DATE,
  
  -- 기본 담당자
  primary_contact_name VARCHAR(255),
  primary_contact_email VARCHAR(255),
  primary_contact_title VARCHAR(255),
  
  -- 추가 연락처 (JSON 배열)
  contacts JSONB DEFAULT '[]',
  
  -- 메모
  notes TEXT,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_customers_user_id ON v2.customers(user_id);
CREATE INDEX idx_customers_deal_status ON v2.customers(deal_status);
CREATE INDEX idx_customers_created_at ON v2.customers(created_at DESC);
```

---

## 📞 미팅 (meetings)

```sql
CREATE TABLE v2.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  customer_id UUID NOT NULL REFERENCES v2.customers(id),
  
  title VARCHAR(255) NOT NULL,
  
  -- 시간
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER,
  
  -- 참석자
  attendees JSONB DEFAULT '[]',  -- [{name, email, company}]
  
  -- 음성 파일
  audio_url TEXT,
  audio_duration_seconds INTEGER,
  transcription TEXT,
  
  -- 분석 상태
  analysis_status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
  analysis_progress INTEGER DEFAULT 0,  -- 0-100%
  
  -- 메모
  notes TEXT,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_meetings_user_id ON v2.meetings(user_id);
CREATE INDEX idx_meetings_customer_id ON v2.meetings(customer_id);
CREATE INDEX idx_meetings_start_time ON v2.meetings(start_time DESC);
CREATE INDEX idx_meetings_analysis_status ON v2.meetings(analysis_status);
```

---

## 🔍 분석 결과 (analysis_results)

```sql
CREATE TABLE v2.analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES v2.meetings(id),
  
  -- 고객 니즈
  customer_needs JSONB NOT NULL DEFAULT '{
    "primary": "",
    "secondary": [],
    "budget": "",
    "timeline": "",
    "decisionMakers": 0,
    "confidence": 0.0
  }',
  
  -- 거래 신호
  deal_signals JSONB NOT NULL DEFAULT '{
    "signal": "neutral",
    "strength": 0.0,
    "closingProbability": 0.0,
    "competition": "",
    "nextSteps": ""
  }',
  
  -- 점수
  scores JSONB NOT NULL DEFAULT '{
    "customerUnderstanding": 0,
    "problemSolving": 0,
    "proposalPersuasion": 0,
    "followUp": 0,
    "teamCollaboration": 0,
    "overall": 0
  }',
  
  -- 감정 분석
  sentiment VARCHAR(50),  -- positive, neutral, negative
  sentiment_score FLOAT,  -- -1.0 to 1.0
  
  -- 추출된 정보
  key_points TEXT[],
  action_items_extracted JSONB DEFAULT '[]',
  
  -- 신뢰도
  overall_confidence FLOAT,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analysis_results_meeting_id ON v2.analysis_results(meeting_id);
CREATE INDEX idx_analysis_results_created_at ON v2.analysis_results(created_at DESC);
```

---

## 📋 액션 항목 (action_items)

```sql
CREATE TABLE v2.action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES v2.meetings(id),
  
  action_text VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- 우선순위
  priority VARCHAR(50) DEFAULT 'medium',  -- high, medium, low
  
  -- 기한
  due_date DATE NOT NULL,
  
  -- 할당자
  assigned_to_user_id UUID REFERENCES v2.users(id),
  
  -- 상태
  status VARCHAR(50) DEFAULT 'pending',  -- pending, in_progress, completed, cancelled
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_rate INTEGER DEFAULT 0,  -- 0-100%
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_action_items_meeting_id ON v2.action_items(meeting_id);
CREATE INDEX idx_action_items_assigned_to ON v2.action_items(assigned_to_user_id);
CREATE INDEX idx_action_items_status ON v2.action_items(status);
CREATE INDEX idx_action_items_due_date ON v2.action_items(due_date);
```

---

## 📧 이메일 (emails)

```sql
CREATE TABLE v2.emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES v2.meetings(id),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  -- 이메일 정보
  recipient_email VARCHAR(255) NOT NULL,
  cc_emails TEXT[],
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  
  -- 템플릿
  template_name VARCHAR(100),  -- follow_up_proposal, follow_up_general, etc.
  template_variables JSONB,
  
  -- 상태
  status VARCHAR(50) DEFAULT 'draft',  -- draft, sent, opened, clicked
  sent_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  
  -- 첨부파일
  attachments JSONB DEFAULT '[]',  -- [{name, url, size}]
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_emails_meeting_id ON v2.emails(meeting_id);
CREATE INDEX idx_emails_user_id ON v2.emails(user_id);
CREATE INDEX idx_emails_status ON v2.emails(status);
```

---

## 📚 학습 사례 (learning_cases)

```sql
CREATE TABLE v2.learning_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  -- 사례 정보
  customer_name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),
  company_size VARCHAR(50),
  deal_amount_krw BIGINT,
  
  -- 결과
  outcome VARCHAR(50) NOT NULL,  -- won, lost, no_bid
  duration_days INTEGER,
  
  -- 전략
  strategy TEXT[],
  lessons_learned TEXT,
  
  -- 연관성 계산용
  similarity_features JSONB,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_learning_cases_user_id ON v2.learning_cases(user_id);
CREATE INDEX idx_learning_cases_outcome ON v2.learning_cases(outcome);
CREATE INDEX idx_learning_cases_created_at ON v2.learning_cases(created_at DESC);
```

---

## 📊 사용자 점수 (user_scores)

```sql
CREATE TABLE v2.user_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  -- 점수
  current_score INTEGER DEFAULT 0,
  weekly_score INTEGER DEFAULT 0,
  monthly_score INTEGER DEFAULT 0,
  
  -- 점수 분석
  score_components JSONB DEFAULT '{
    "customerUnderstanding": 0,
    "problemSolving": 0,
    "proposalPersuasion": 0,
    "followUp": 0,
    "teamCollaboration": 0
  }',
  
  -- 지표
  metrics JSONB DEFAULT '{
    "meetingsThisWeek": 0,
    "actionCompletionRate": 0.0,
    "customerSatisfaction": 0.0
  }',
  
  -- 순위
  weekly_rank INTEGER,
  monthly_rank INTEGER,
  
  -- 주간/월간
  week_start_date DATE,
  month_start_date DATE,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_scores_user_id_week ON v2.user_scores(user_id, week_start_date);
CREATE INDEX idx_user_scores_weekly_rank ON v2.user_scores(weekly_rank);
```

---

## 🔔 알림 (notifications)

```sql
CREATE TABLE v2.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  -- 알림 유형
  type VARCHAR(100) NOT NULL,  -- analysis_complete, important_signal, improvement_suggestion
  
  -- 제목 & 본문
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  
  -- 링크
  related_entity_type VARCHAR(50),  -- meeting, customer, action_item
  related_entity_id UUID,
  
  -- 상태
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  
  -- 채널
  channels JSONB DEFAULT '["in_app"]',  -- in_app, email, push, sms
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notifications_user_id ON v2.notifications(user_id);
CREATE INDEX idx_notifications_is_read ON v2.notifications(is_read);
CREATE INDEX idx_notifications_created_at ON v2.notifications(created_at DESC);
```

---

## 📱 디바이스 관리 (devices)

```sql
CREATE TABLE v2.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  device_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,  -- ios, android, web
  device_name VARCHAR(255),
  
  -- 푸시 알림
  fcm_token TEXT,
  fcm_token_updated_at TIMESTAMP WITH TIME ZONE,
  
  -- 상태
  is_active BOOLEAN DEFAULT true,
  last_active_at TIMESTAMP WITH TIME ZONE,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_devices_user_id ON v2.devices(user_id);
CREATE INDEX idx_devices_device_id ON v2.devices(device_id);
```

---

## 🔐 세션 관리 (sessions)

```sql
CREATE TABLE v2.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id),
  
  refresh_token VARCHAR(500) UNIQUE NOT NULL,
  
  -- 세션 정보
  ip_address INET,
  user_agent TEXT,
  device_id UUID REFERENCES v2.devices(id),
  
  -- 상태
  is_active BOOLEAN DEFAULT true,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sessions_user_id ON v2.sessions(user_id);
CREATE INDEX idx_sessions_refresh_token ON v2.sessions(refresh_token);
CREATE INDEX idx_sessions_expires_at ON v2.sessions(expires_at);
```

---

## 📝 감사 로그 (audit_logs)

```sql
CREATE TABLE v2.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES v2.users(id),
  
  -- 작업 정보
  action VARCHAR(100) NOT NULL,  -- create, update, delete, view
  entity_type VARCHAR(100) NOT NULL,  -- meeting, customer, action_item
  entity_id UUID,
  
  -- 변경 내용
  old_values JSONB,
  new_values JSONB,
  
  -- 메타정보
  ip_address INET,
  user_agent TEXT,
  
  -- 타임스탐프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON v2.audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON v2.audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON v2.audit_logs(created_at DESC);
```

---

## 🔄 주요 뷰 (Views)

### **최근 미팅 대시보드**
```sql
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
ORDER BY m.created_at DESC;
```

### **사용자 주간 성과**
```sql
CREATE VIEW v2.vw_weekly_performance AS
SELECT 
  u.id,
  u.name,
  us.weekly_score,
  us.weekly_rank,
  EXTRACT(WEEK FROM CURRENT_DATE) as week_number,
  COUNT(DISTINCT m.id) as meetings_this_week,
  COALESCE(AVG((ar.scores ->> 'overall')::INTEGER), 0) as avg_meeting_score
FROM v2.users u
LEFT JOIN v2.user_scores us ON u.id = us.user_id
LEFT JOIN v2.meetings m ON u.id = m.user_id 
  AND m.created_at >= CURRENT_DATE - INTERVAL '7 days'
LEFT JOIN v2.analysis_results ar ON m.id = ar.meeting_id
GROUP BY u.id, u.name, us.weekly_score, us.weekly_rank;
```

---

## 🔌 데이터 마이그레이션

### **V1 → V2 데이터 마이그레이션 (예시)**

```sql
-- 1. 사용자 마이그레이션
INSERT INTO v2.users (email, name, password_hash, role, monthly_target_krw, created_at)
SELECT 
  email, 
  name, 
  password_hash, 
  role,
  monthly_target_krw,
  created_at
FROM public.users
WHERE deleted_at IS NULL;

-- 2. 고객 마이그레이션
INSERT INTO v2.customers (user_id, company_name, industry, deal_status, created_at)
SELECT 
  u.id,
  c.name,
  c.industry,
  c.status,
  c.created_at
FROM public.customers c
JOIN v2.users u ON c.user_id = u.id
WHERE c.deleted_at IS NULL;

-- 3. 미팅 마이그레이션 (선택적 - 과거 데이터)
INSERT INTO v2.meetings (user_id, customer_id, title, start_time, end_time, created_at)
SELECT 
  u.id,
  c.id,
  m.title,
  m.start_time,
  m.end_time,
  m.created_at
FROM public.meetings m
JOIN v2.users u ON m.user_id = u.id
JOIN v2.customers c ON m.customer_id = c.id
WHERE m.created_at >= '2026-01-01';
```

---

## ✅ 체크리스트

### **개발**
- [ ] 스키마 생성 스크립트 작성
- [ ] 마이그레이션 스크립트 작성
- [ ] 시드 데이터 준비
- [ ] 인덱스 성능 테스트
- [ ] 백업 전략 수립

### **성능**
- [ ] 쿼리 성능 최적화
- [ ] 인덱스 전략 검증
- [ ] 캐싱 계획 (Redis)
- [ ] 파티셔닝 계획 (시계열 데이터)

### **보안**
- [ ] Row-Level Security (RLS) 정책
- [ ] 암호화 (PII 데이터)
- [ ] 접근 제어 (RBAC)
- [ ] 감사 로그 (audit_logs)

### **테스트**
- [ ] 단위 테스트 (쿼리)
- [ ] 통합 테스트 (API ↔ DB)
- [ ] 부하 테스트
- [ ] 마이그레이션 테스트

---

**다음 단계:** ORM 매핑 (TypeORM/Prisma) 및 마이그레이션 도구 설정

