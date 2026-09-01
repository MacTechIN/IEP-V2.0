# API 명세서 (API Specification)

**버전:** 1.0  
**최종 수정:** 2026-08-06  
**기술 스택:** Node.js (Express) + PostgreSQL  
**인증:** JWT 토큰 기반  
**콘텐츠 타입:** application/json  

---

## 📋 API 개요

### **베이스 URL**
```
개발: https://api-dev.sep.local/v2/
스테이징: https://api-stg.sep.local/v2/
프로덕션: https://api.sep.com/v2/
```

### **공통 헤더**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
X-Client-Version: 2.0
X-Request-ID: <uuid>
```

### **응답 포맷**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-08-06T14:30:00Z",
    "requestId": "uuid"
  }
}
```

---

## 👤 인증 (Authentication)

### **POST /auth/login**
사용자 로그인 및 JWT 토큰 발급

**요청:**
```json
{
  "email": "kim@company.com",
  "password": "secure_password",
  "deviceId": "device-uuid"
}
```

**응답:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "user": {
      "id": "user-123",
      "name": "김현진",
      "email": "kim@company.com",
      "role": "sales_rep"
    },
    "expiresIn": 3600
  }
}
```

**에러:**
- 401: 인증 실패 (이메일/비밀번호 오류)
- 429: 로그인 시도 횟수 초과

---

### **POST /auth/refresh**
액세스 토큰 갱신

**요청:**
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**응답:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "expiresIn": 3600
  }
}
```

---

### **POST /auth/logout**
로그아웃 (토큰 무효화)

**응답:**
```json
{
  "success": true,
  "data": { "message": "로그아웃 완료" }
}
```

---

## 📞 미팅 (Meeting)

### **POST /meetings**
새 미팅 기록 (음성 파일 업로드 포함)

**요청:**
```json
{
  "customerId": "cust-456",
  "title": "ABC Corp 미팅",
  "startTime": "2026-08-06T14:00:00Z",
  "endTime": "2026-08-06T14:45:00Z",
  "attendees": ["kim@company.com", "kyh@abc.com"],
  "notes": "고객 니즈 파악 미팅",
  "audioFile": "base64_encoded_audio or multipart upload"
}
```

**응답:**
```json
{
  "success": true,
  "data": {
    "meetingId": "meet-789",
    "status": "processing",
    "analysisProgress": 0,
    "createdAt": "2026-08-06T14:45:00Z"
  }
}
```

**에러:**
- 400: 필수 필드 누락
- 413: 파일 크기 초과 (최대 100MB)
- 415: 지원하지 않는 파일 형식

---

### **GET /meetings/{meetingId}**
미팅 상세 정보 조회

**응답:**
```json
{
  "success": true,
  "data": {
    "meetingId": "meet-789",
    "customerId": "cust-456",
    "title": "ABC Corp 미팅",
    "startTime": "2026-08-06T14:00:00Z",
    "endTime": "2026-08-06T14:45:00Z",
    "status": "completed",
    "analysis": {
      "duration": 45,
      "transcription": "...",
      "keyPoints": [
        "비용 절감이 주요 니즈",
        "3개월 내 의사결정",
        "ROI 분석 필요"
      ],
      "sentiment": "positive",
      "confidenceScore": 0.92
    },
    "audioUrl": "https://cdn.sep.com/audio/meet-789.wav",
    "createdBy": "user-123",
    "createdAt": "2026-08-06T14:45:00Z"
  }
}
```

---

### **GET /meetings**
미팅 목록 조회 (페이지네이션)

**쿼리:**
```
?limit=20&offset=0&status=completed&customerId=cust-456&dateFrom=2026-08-01&dateTo=2026-08-31
```

**응답:**
```json
{
  "success": true,
  "data": [
    { "meetingId": "meet-789", "title": "...", ... },
    { "meetingId": "meet-788", "title": "...", ... }
  ],
  "meta": {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### **PATCH /meetings/{meetingId}**
미팅 정보 업데이트

**요청:**
```json
{
  "title": "업데이트된 제목",
  "notes": "추가 메모",
  "actionItems": [
    { "action": "기술검토 일정", "dueDate": "2026-08-10", "assignee": "박철수" }
  ]
}
```

---

### **DELETE /meetings/{meetingId}**
미팅 삭제 (소프트 삭제)

---

## 👥 고객 (Customer)

### **GET /customers/{customerId}**
고객 상세 정보 조회

**응답:**
```json
{
  "success": true,
  "data": {
    "customerId": "cust-456",
    "companyName": "ABC Corp",
    "industry": "IT Solutions",
    "companySize": "medium",
    "budget": {
      "min": 5000000,
      "max": 10000000,
      "currency": "KRW"
    },
    "contacts": [
      {
        "name": "김영희",
        "title": "대표",
        "email": "kyh@abc.com",
        "phone": "010-xxxx-yyyy",
        "priority": "high"
      }
    ],
    "meetings": [
      { "meetingId": "meet-789", "date": "2026-08-06", "status": "completed" }
    ],
    "dealStatus": "in_progress",
    "estimatedClosingDate": "2026-09-15",
    "createdAt": "2026-07-01T10:00:00Z"
  }
}
```

---

### **POST /customers**
새 고객 등록

**요청:**
```json
{
  "companyName": "ABC Corp",
  "industry": "IT Solutions",
  "companySize": "medium",
  "budget": {
    "min": 5000000,
    "max": 10000000
  },
  "primaryContact": {
    "name": "김영희",
    "title": "대표",
    "email": "kyh@abc.com",
    "phone": "010-xxxx-yyyy"
  }
}
```

---

### **GET /customers**
고객 목록 조회

**쿼리:**
```
?limit=20&offset=0&status=active&industry=IT&dealStatus=in_progress
```

---

## 📊 분석 & 점수 (Analysis)

### **GET /analysis/meeting/{meetingId}**
미팅 분석 결과 (AI 분석)

**응답:**
```json
{
  "success": true,
  "data": {
    "meetingId": "meet-789",
    "customerNeeds": {
      "primary": "비용 절감",
      "secondary": ["운영 효율화", "시스템 통합"],
      "budget": "확인됨",
      "timeline": "3개월 내",
      "decisionMakers": 3,
      "confidence": 0.95
    },
    "dealSignals": {
      "signal": "positive",
      "strength": 8.5,
      "closingProbability": 0.70,
      "competition": "none",
      "nextSteps": "기술 검토 일정 잡기"
    },
    "actionItems": [
      {
        "action": "기술검토 일정",
        "priority": "high",
        "dueDate": "2026-08-10",
        "ownerEmail": "kim@company.com"
      }
    ],
    "score": {
      "customerUnderstanding": 88,
      "problemSolving": 85,
      "proposalPersuasion": 78,
      "followUp": 76,
      "teamCollaboration": 80,
      "overall": 82
    },
    "sentiment": "positive",
    "transcriptionUrl": "..."
  }
}
```

---

### **GET /dashboard/score/{userId}**
사용자 점수 및 성과 (대시보드용)

**응답:**
```json
{
  "success": true,
  "data": {
    "userId": "user-123",
    "currentScore": 82,
    "weeklyScore": 320,
    "teamAverageScore": 300,
    "weeklyMetrics": {
      "meetings": 6,
      "teamAverageMeetings": 5,
      "actionCompletionRate": 0.82,
      "customerSatisfaction": 8.2
    },
    "ranking": {
      "userRank": 2,
      "totalUsers": 50,
      "topPerformers": [
        { "name": "이순신", "score": 340, "rank": 1 },
        { "name": "나", "score": 320, "rank": 2 },
        { "name": "강감찬", "score": 310, "rank": 3 }
      ]
    },
    "improvements": [
      "고객 접촉 빈도를 2배 늘리면 점수 +50 가능"
    ]
  }
}
```

---

### **GET /dashboard/insights/{userId}**
사용자 개인화된 인사이트

**응답:**
```json
{
  "success": true,
  "data": {
    "strengths": [
      "고객 니즈 파악이 뛰어남",
      "기술적 이해도가 높음"
    ],
    "improvements": [
      "후속 액션 실행 속도 ↑",
      "팀 피드백 적극 수용"
    ],
    "recommendations": [
      {
        "title": "고급 협상 기법",
        "description": "당신의 제안 설득력을 82에서 95로 올릴 수 있습니다",
        "learningTime": 120,
        "priority": "high"
      }
    ]
  }
}
```

---

## 📋 액션 (Action Item)

### **POST /actions**
액션 항목 생성

**요청:**
```json
{
  "meetingId": "meet-789",
  "action": "기술검토 일정 잡기",
  "priority": "high",
  "dueDate": "2026-08-10",
  "assignee": "kim@company.com",
  "description": "ABC Corp 기술팀과 기술 스택 검토"
}
```

---

### **GET /actions**
액션 목록 조회

**쿼리:**
```
?status=pending&dueDateFrom=2026-08-01&dueDateTo=2026-08-31&priority=high
```

---

### **PATCH /actions/{actionId}**
액션 상태 업데이트

**요청:**
```json
{
  "status": "completed",
  "completedDate": "2026-08-08T10:30:00Z"
}
```

---

## 📧 이메일 (Email)

### **GET /email/draft/{meetingId}**
Follow-up 이메일 초안 생성 (AI 기반)

**응답:**
```json
{
  "success": true,
  "data": {
    "recipient": "kyh@abc.com",
    "subject": "[제안] ABC Corp을 위한 맞춤형 솔루션",
    "body": "김영희 대표님께...",
    "template": "follow_up_proposal",
    "variables": {
      "companyName": "ABC Corp",
      "keyNeed": "비용 절감",
      "expectedBenefit": "인력 비용 30% 절감"
    }
  }
}
```

---

### **POST /email/send**
이메일 발송

**요청:**
```json
{
  "to": "kyh@abc.com",
  "subject": "[제안] ABC Corp을 위한 맞춤형 솔루션",
  "body": "...",
  "draftId": "draft-123",
  "cc": ["kim@company.com"],
  "attachments": ["proposal.pdf"]
}
```

---

## 📚 학습 (Learning)

### **GET /learning/similar-cases**
유사한 성공/실패 사례 조회

**쿼리:**
```
?meetingId=meet-789&limit=5
```

**응답:**
```json
{
  "success": true,
  "data": [
    {
      "caseId": "case-001",
      "ownerName": "이순신",
      "ownerScore": 92,
      "customerName": "XYZ Corp",
      "similarity": 0.85,
      "dealAmount": 8000000,
      "outcome": "won",
      "duration": 28,
      "strategy": [
        "의사결정자 3명 개별 미팅",
        "기술검토 → 파일럿 제안",
        "ROI 분석으로 승리"
      ]
    }
  ]
}
```

---

## 🔔 알림 (Notification)

### **POST /notifications/subscribe**
푸시 알림 구독 (모바일)

**요청:**
```json
{
  "deviceId": "device-uuid",
  "platform": "ios",
  "fcmToken": "firebase-token"
}
```

---

### **GET /notifications**
알림 목록 조회

**쿼리:**
```
?limit=20&read=false
```

---

### **PATCH /notifications/{notificationId}/read**
알림 읽음 표시

---

## ⚙️ 사용자 설정 (User Settings)

### **GET /users/me**
현재 사용자 정보

**응답:**
```json
{
  "success": true,
  "data": {
    "userId": "user-123",
    "name": "김현진",
    "email": "kim@company.com",
    "role": "sales_rep",
    "department": "Sales",
    "monthlyTarget": 5000000,
    "currentProgress": 3400000,
    "completionRate": 0.68,
    "profileImage": "https://cdn.sep.com/profile/user-123.jpg"
  }
}
```

---

### **PATCH /users/me**
사용자 정보 업데이트

**요청:**
```json
{
  "name": "김현진",
  "monthlyTarget": 5000000,
  "notificationPreferences": {
    "analysisComplete": true,
    "importantSignal": true,
    "improvementSuggestion": true
  }
}
```

---

## 🔐 에러 코드

| 코드 | 설명 | HTTP |
|------|------|------|
| 1001 | 인증 실패 | 401 |
| 1002 | 권한 없음 | 403 |
| 1003 | 리소스 없음 | 404 |
| 2001 | 필수 필드 누락 | 400 |
| 2002 | 유효하지 않은 데이터 | 400 |
| 3001 | 서버 오류 | 500 |
| 3002 | 서비스 사용 불가 | 503 |

**에러 응답:**
```json
{
  "success": false,
  "error": {
    "code": 2001,
    "message": "필수 필드 누락: customerId",
    "details": {
      "field": "customerId"
    }
  }
}
```

---

## 📊 페이지네이션

모든 리스트 엔드포인트는 다음을 지원합니다:

```
?limit=20&offset=0&sortBy=createdAt&sortOrder=desc
```

**응답 메타:**
```json
{
  "meta": {
    "total": 100,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## 🔄 비동기 작업 (Async Operations)

분석이 완료되면 웹훅을 통해 즉시 알림:

**웹훅 구독:**
```
POST /webhooks/subscribe
{
  "events": ["meeting.analysis.completed", "action.completed"],
  "url": "https://your-server.com/webhook"
}
```

**웹훅 페이로드:**
```json
{
  "event": "meeting.analysis.completed",
  "data": {
    "meetingId": "meet-789",
    "analysisResult": { ... }
  },
  "timestamp": "2026-08-06T14:50:00Z"
}
```

---

## 📈 레이트 제한

- **일반 요청**: 100 req/min per user
- **분석 요청**: 10 req/min per user
- **파일 업로드**: 5 req/min per user

**헤더:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1691334000
```

---

## ✅ 체크리스트

- [ ] API 엔드포인트 개발
- [ ] JWT 인증 구현
- [ ] 요청 검증 (Joi/Zod)
- [ ] 오류 처리 미들웨어
- [ ] 로깅 & 모니터링
- [ ] API 문서 (Swagger/OpenAPI)
- [ ] 성능 최적화 (캐싱)
- [ ] 보안 (CORS, XSS, SQL Injection)
- [ ] 테스트 (단위, 통합)
- [ ] 배포 (Docker, K8s)

---

**다음 단계:** Swagger/OpenAPI 문서 자동 생성

