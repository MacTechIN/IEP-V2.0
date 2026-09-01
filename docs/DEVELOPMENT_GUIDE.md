# 개발 환경 설정 가이드 (Development Setup)

**최종 수정:** 2026-08-06  
**버전:** 1.0  

---

## 📋 사전 요구사항

### **필수 설치**
- Node.js 18+ ([다운로드](https://nodejs.org/))
- npm 9+ (Node.js와 함께 설치됨)
- Git
- Docker & Docker Compose (로컬 DB/Redis)
- VS Code 또는 JetBrains IDE

### **권장 도구**
- Postman 또는 Insomnia (API 테스트)
- DBeaver (데이터베이스 관리)
- Figma (디자인 시스템)

---

## 🚀 빠른 시작 (5분)

### **1단계: 저장소 클론**
```bash
cd /home/jnh/workspace
git clone <repo-url> SEP-V2.0
cd SEP-V2.0
```

### **2단계: 환경 설정**
```bash
# 백엔드
cp backend/.env.example backend/.env
# 필요하면 backend/.env 수정

# 프론트엔드 (웹)
cp frontend/web/.env.example frontend/web/.env
```

### **3단계: Docker 시작**
```bash
cd deploy
docker-compose up -d

# 확인
docker-compose ps
```

### **4단계: 백엔드 설정**
```bash
cd backend
npm install
npm run dev
# ✅ 🚀 Server running on port 3000
```

### **5단계: 프론트엔드 (웹) 설정**
```bash
cd frontend/web
npm install
npm run dev
# ✅ 브라우저에서 http://localhost:5173 열기
```

### **6단계: 프론트엔드 (모바일) 설정**
```bash
cd frontend/mobile
npm install
npm run dev
# ✅ Expo 앱에서 QR 코드 스캔
```

---

## 📁 프로젝트 구조

```
SEP-V2.0/
├── backend/                    # Node.js/Express API
│   ├── src/
│   │   ├── index.ts           # 메인 서버
│   │   ├── routes/            # API 라우트
│   │   ├── middleware/        # 미들웨어
│   │   ├── services/          # 비즈니스 로직
│   │   ├── models/            # DB 모델
│   │   └── utils/             # 유틸리티
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── web/                   # React 웹 대시보드
│   │   ├── src/
│   │   │   ├── main.tsx       # 진입점
│   │   │   ├── App.tsx        # 루트 컴포넌트
│   │   │   ├── pages/         # 페이지 (라우트별)
│   │   │   ├── components/    # UI 컴포넌트
│   │   │   ├── store/         # Redux 스토어
│   │   │   ├── hooks/         # Custom hooks
│   │   │   └── styles/        # 글로벌 스타일
│   │   └── vite.config.ts     # Vite 설정
│   │
│   └── mobile/                # React Native 모바일 앱
│       ├── src/
│       │   ├── app.json       # Expo 설정
│       │   ├── App.tsx        # 루트 컴포넌트
│       │   ├── screens/       # 화면
│       │   ├── components/    # UI 컴포넌트
│       │   ├── store/         # Redux 스토어
│       │   └── hooks/         # Custom hooks
│       └── eas.json           # EAS 빌드 설정
│
├── database/
│   └── 001_init_v2_schema.sql # DB 스키마
│
├── deploy/
│   ├── docker-compose.yml     # 로컬 개발 환경
│   ├── Dockerfile.backend     # 백엔드 이미지
│   ├── .env.example           # 환경변수 예제
│   └── kubernetes/            # K8s 설정 (향후)
│
└── docs/
    ├── MVP_V2.0_PLAN.md       # 마스터 계획
    ├── API_SPEC.md            # API 명세
    ├── DATABASE_SCHEMA.md     # DB 스키마
    ├── COMPONENT_LIBRARY.md   # UI 컴포넌트
    ├── WIREFRAME.md           # 와이어프레임
    └── DEVELOPMENT_GUIDE.md   # 이 문서
```

---

## 🛠️ 개발 워크플로우

### **백엔드 개발**

**핫 리로드로 개발:**
```bash
cd backend
npm run dev
# 파일 변경시 자동 재시작
```

**테스트 실행:**
```bash
npm run test
npm run test:watch
npm run test:coverage
```

**타입 검사:**
```bash
npm run type-check
```

**린트 & 포매팅:**
```bash
npm run lint
npm run lint:fix
```

**빌드:**
```bash
npm run build
# dist/ 폴더에 컴파일된 JS 생성
```

---

### **프론트엔드 (웹) 개발**

**핫 리로드로 개발:**
```bash
cd frontend/web
npm run dev
# 브라우저 http://localhost:5173 자동 열림
```

**빌드:**
```bash
npm run build
# dist/ 폴더에 최적화된 결과 생성
```

**타입 검사:**
```bash
npm run type-check
```

**린트:**
```bash
npm run lint
```

---

### **프론트엔드 (모바일) 개발**

**Expo로 개발:**
```bash
cd frontend/mobile
npm run dev
# 터미널에서 QR 코드 확인
# Expo 앱 (iOS/Android)에서 카메라로 스캔
```

**아이폰에서 테스트:**
```bash
# 1. Simulator 실행
open -a Simulator

# 2. Expo 앱에서 프로젝트 열기
```

**안드로이드에서 테스트:**
```bash
# 1. Android Studio 열기
# 2. Virtual Device 시작
# 3. Expo 앱에서 프로젝트 열기
```

---

## 🗄️ 데이터베이스

### **Docker로 시작**
```bash
cd deploy
docker-compose up postgres
```

### **마이그레이션 실행**
```bash
docker-compose exec postgres psql -U postgres -d sep_v2_dev -f /docker-entrypoint-initdb.d/001_init.sql
```

### **로컬 연결**
```bash
# psql CLI로 연결
psql -h localhost -U postgres -d sep_v2_dev
# 비밀번호: postgres (기본값)

# 또는 DBeaver에서
- Host: localhost
- Port: 5432
- Database: sep_v2_dev
- User: postgres
- Password: postgres
```

### **샘플 쿼리**
```sql
-- 사용자 조회
SELECT id, name, email, role FROM v2.users;

-- 고객 조회
SELECT id, company_name, deal_status FROM v2.customers;

-- 미팅 조회
SELECT id, title, status FROM v2.meetings;
```

---

## 🔌 API 테스트

### **Postman 설정**

**1. Postman 환경 변수 생성:**
```json
{
  "base_url": "http://localhost:3000/api/v2",
  "token": "{{accessToken}}"
}
```

**2. 로그인 API 호출:**
```
POST http://localhost:3000/api/v2/auth/login
Content-Type: application/json

{
  "email": "kim@company.com",
  "password": "password123"
}
```

**3. 응답에서 토큰 추출:**
```javascript
// Tests 탭에서
var jsonData = pm.response.json();
pm.environment.set("accessToken", jsonData.data.accessToken);
```

**4. 인증 헤더 설정:**
```
Authorization: Bearer {{token}}
```

---

## 📊 Git 워크플로우

### **브랜치 전략 (Git Flow)**

```
main                    (프로덕션)
  └── release/2.0.0     (릴리스)
  │     └── hotfix/fix-bug
  └── develop           (개발 메인)
        ├── feature/ui-update
        ├── feature/api-integration
        └── bugfix/auth-error
```

### **브랜치 생성**

```bash
# 기능 개발
git checkout -b feature/meeting-upload
git commit -m "feat: 미팅 음성 파일 업로드"
git push origin feature/meeting-upload

# 버그 수정
git checkout -b bugfix/auth-token-expire
git commit -m "fix: 토큰 만료 시간 계산 오류"
git push origin bugfix/auth-token-expire

# PR 생성 후 코드 리뷰 → 머지
```

---

## 🧪 테스팅 가이드

### **단위 테스트**
```bash
# 백엔드
cd backend
npm run test

# 특정 파일만
npm run test src/routes/auth.test.ts
```

### **통합 테스트**
```bash
# API 엔드포인트 테스트
npm run test:integration
```

### **E2E 테스트 (추후 추가)**
```bash
npm run test:e2e
```

### **테스트 커버리지**
```bash
npm run test:coverage
# coverage/ 폴더의 html/index.html 확인
```

---

## 🔐 보안 체크리스트

### **개발 중**
- [ ] .env 파일에 민감한 정보 저장 (git에 커밋 안 함)
- [ ] HTTPS 라우트 확인 (프로덕션)
- [ ] SQL Injection 방지 (쿼리 파라미터화)
- [ ] XSS 방지 (입력 검증)
- [ ] CORS 설정 확인
- [ ] JWT 토큰 만료 시간 설정

### **배포 전**
- [ ] 모든 환경변수 설정
- [ ] 데이터베이스 비밀번호 강화
- [ ] API 레이트 제한 활성화
- [ ] 에러 메시지 최소화 (공격 정보 노출 방지)
- [ ] 로깅 & 모니터링 활성화

---

## 📈 성능 최적화 팁

### **백엔드**
- 데이터베이스 인덱스 생성 (쿼리 성능)
- Redis 캐싱 활용
- 쿼리 최적화 (N+1 문제 해결)
- 페이지네이션 구현

### **프론트엔드**
- 번들 크기 최적화
- 이미지 최적화 (WebP, lazy loading)
- 코드 스플리팅
- 불필요한 리렌더링 제거

---

## 🆘 트러블슈팅

### **포트 충돌**
```bash
# 포트 3000 이미 사용 중
lsof -i :3000
kill -9 <PID>

# 또는 다른 포트 사용
PORT=3001 npm run dev
```

### **데이터베이스 연결 오류**
```bash
# PostgreSQL 상태 확인
docker-compose ps postgres

# 로그 확인
docker-compose logs postgres

# 컨테이너 재시작
docker-compose restart postgres
```

### **npm 의존성 문제**
```bash
# 캐시 삭제 후 재설치
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### **TypeScript 타입 오류**
```bash
# 타입 정의 다시 빌드
npm install
npm run type-check

# 특정 패키지 타입 설치
npm install --save-dev @types/packagename
```

---

## 📚 추가 자료

- [Express.js 공식 문서](https://expressjs.com/)
- [React 18 문서](https://react.dev/)
- [React Native 문서](https://reactnative.dev/)
- [PostgreSQL 공식 문서](https://www.postgresql.org/docs/)
- [TypeScript 핸드북](https://www.typescriptlang.org/docs/)

---

## ✅ 체크리스트

개발 시작 전 확인:
- [ ] Node.js 18+ 설치됨
- [ ] Git 저장소 클론됨
- [ ] Docker & Docker Compose 설치됨
- [ ] .env 파일 생성됨
- [ ] `docker-compose up -d` 실행됨
- [ ] `npm install` 완료됨
- [ ] `npm run dev` 실행됨
- [ ] http://localhost:3000/health 응답 확인됨
- [ ] 데이터베이스 접속 확인됨

---

**개발 환경 설정 완료! 🎉 이제 코딩을 시작해도 좋습니다!**

