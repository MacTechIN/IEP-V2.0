# v2 MVP → maindev 서버 상용 배포 계획서 (작업 단위)

**목표:** SEP v2 백엔드 MVP를 **maindev 서버(192.168.0.131)** 에서 실제 PostgreSQL 영속성으로
동작·검증한다. 각 단위마다 "코드 작성"이 아니라 **실제 빌드·기동·검증(gate)** 을 통과해야 완료로 본다.

**작성일:** 2026-08-07 · **대상 서버:** maindev (Ubuntu 22.04, x86_64, Docker 29 / Compose 2.40, 62GB RAM, 648GB free)

---

## ⚠️ 배경 — 왜 이 계획이 필요한가

이전 커밋들이 "DB 연동 완료 ✅", "OpenAI 연동 완료 ✅", "production ready ✅" 라고 기록했으나,
**컨테이너에서 실제로 검증된 적이 없었다.** 이번에 실측으로 아래를 발견:

- 실행 중이던 백엔드는 여전히 **in-memory** (API 생성 고객이 Postgres에 안 들어감)
- 이미지가 `--build` 없이 재기동되어 DB 연동 코드가 **한 번도 빌드된 적 없음**
- 빌드 시도 시 **TypeScript 컴파일 에러 4건** → 애초에 컴파일 불가였음
- Dockerfile이 `database/` 폴더 미포함 → 마이그레이션 파일 없어 부팅 크래시 예정이었음
- 시드 사용자 비밀번호 해시가 **가짜 문자열** → DB 인증 전환 시 로그인 전원 실패
- 라우트가 `user-123` 하드코딩 → UUID 컬럼에 INSERT 시 타입 에러

즉, 실제로는 "작동하지 않는 상태"였다. 이 계획서는 이를 **정직하게 하나씩 고쳐 실제 동작**시키는 것이 목적.

---

## 배포 설계 결정 (maindev 제약 반영)

- **백엔드 호스트 포트:** `3080` (3000/3001/80/8080 이미 사용 중 → 충돌 회피)
- **Postgres/Redis:** 호스트에 포트 노출하지 않음(내부 네트워크 전용) — 보안 + 충돌 회피
- **프로젝트명/네트워크:** `sep-v2` (기존 jnh-webui/jnh-qdrant/pia-test/jnh-litellm 와 무충돌 확인됨)
- **배포 경로:** `/home/sam/sep-v2` (rsync, GitHub 자격증명 불필요)
- **비밀값:** `JWT_SECRET`, DB 비밀번호를 `openssl rand`로 신규 생성 → `.env.production`
- **restart 정책:** `unless-stopped`
- ⚠️ 기본 계정 `kim@company.com / password123` 은 **상용 시 반드시 교체** (계획서에 명시)

---

## 작업 단위 (Work Units)

### U0 — 환경 베이스라인  ✅ 완료
- [x] maindev LAN SSH 키 인증 확립 (192.168.0.131, user sam)
- [x] Docker/Compose·자원·여유포트·rsync/git 확인
- **Gate:** `ssh maindev docker ps` 동작 → **통과**

### U1 — 백엔드 컴파일 & 이미지 정합성  ✅ 완료(로컬 빌드 성공)
- [x] Dockerfile에 `COPY database ./database` 추가
- [x] `runMigrations` 마이그레이션 파일 없을 때 graceful skip
- [x] TS 에러 수정: `Customer.notes`, `@types/pg`, `err: Error`
- [x] `package-lock.json` 동기화(@types/pg)
- **Gate:** `docker compose build` 성공, 이미지에 `/app/database` 존재 → **통과**

### U2 — 인증 & 사용자 스코프(DB 기준) 정합성  ✅ 완료
- [x] 시드 비밀번호 해시를 실제 bcrypt(password123)로 교체
- [x] `routes/customers.ts` (2곳) `user-123` → `req.user!.sub`
- [x] `routes/meetings.ts` (2곳) `user-123` → `req.user!.sub`
- [x] `routes/actions.ts`, `routes/analysis.ts` 사용자 하드코딩 없음 확인
- [x] 추가 발견·수정: `analysis_results.key_points`(TEXT[])에 JSON 문자열 대신 배열 전달
- **Gate:** 로그인 시 실제 UUID 반환, 토큰으로 보호 라우트 접근 → **통과**
- (참고) `__tests__/*`는 in-memory·user-123 가정으로 작성됨 → 별도 갱신 필요(배포 비차단)

### U3 — 로컬 전체 검증 (정직성 GATE)  ✅ 완료 (통과)
- [x] 볼륨 초기화 후 `up -d --build`
- [x] 로그인 → 고객 생성 → **Postgres row 확인** → 백엔드 재시작 후 **잔존 확인**
- [x] 미팅 생성 → 분석(fallback) 완료 → `analysis_results` 저장 → 대시보드 점수(78) 반영
- **Gate 결과:** login/create/DB persist/analysis/restart/dashboard **전부 ✅** → maindev 진행 승인

### U4 — 상용 구성  ✅ 완료
- [x] `docker-compose.prod.yml`(자체 완결형): backend `3080:3000`, DB/Redis 미노출, restart, NODE_ENV=production, src 바인드마운트 제거
- [x] `.dockerignore` 추가(빌드 컨텍스트 경량화), `.gitignore`에 `.env.production*` 추가
- [x] `.env.production`(openssl 비밀값) — 로컬 검증용 생성 + maindev에 별도 생성
- **Gate:** `docker compose config` 통과, 공개 포트 3080 단독 확인 → **통과**

### U5 — maindev 배포  ✅ 완료
- [x] rsync → `/home/sam/sep-v2` (node_modules/dist/.git/frontend/mvp/.env 제외)
- [x] maindev에서 fresh 시크릿 생성 후 `docker compose -p sep-v2 -f docker-compose.prod.yml up -d --build`
- **Gate:** 3개 컨테이너 healthy, 기존 컨테이너(jnh-*/pia-test) 무영향 → **통과**

### U6 — maindev 스모크 테스트  ✅ 완료
- [x] `192.168.0.131:3080`: health/login/고객생성→**maindev Postgres 확인**/미팅+분석(78)/대시보드/401 인증
- **접속 URL:** `http://192.168.0.131:3080` (LAN 전용, AI는 현재 시뮬레이션) → **통과**

### U7 — 커밋 & 정직한 상태 기록  ✅ 완료
- [x] 백엔드 수정 커밋(0446167) + 배포 구성 커밋
- [x] 본 계획서 실제 결과로 갱신

---

# Phase ② — 실 UI + 실 AI (쓸 수 있는 파일럿)  🔜 신규 추가

> Phase ①은 "백엔드가 실제로 도는 것"까지다. 제품의 핵심 가치(녹음→전사→AI 분석)와
> 사용자용 화면은 아직 없다. Phase ②는 이를 만든다. 각 단위도 **실측 통과가 완료 기준.**

### U8 — 오디오 업로드 & 저장  ✅ 완료
- [x] `POST /meetings/:id/audio` (multer, 100MB), 업로드 볼륨 `uploads:/app/uploads`
- [x] `meetings.audio_url` 저장, 소유자 검증
- **Gate:** 업로드 → 202 → DB audio_url 기록 → 파일 저장 확인 (로컬 + maindev 실측) → **통과**

### U9 — STT(전사) 파이프라인  ✅ 완료 (실키 검증)
- [x] `OpenAIService.transcribeAudio()` — Whisper 멀티파트 호출, 실패/무키 시 graceful null
- [x] `processAudio()`: 업로드 → STT → `meetings.transcription` 저장 → 분석
- [x] **실 키로 검증**: 실제 오디오(2분 WAV) → Whisper → **한국어 전사문 747자 DB 저장** 확인
  - 로그: `Calling Whisper STT` → `✓ STT completed (747 chars)` → `Transcription saved`
- [ ] (선택·후속) 25MB/길이 초과 청크 분할
- **Gate:** 실제 오디오 → 전사문 DB 저장 → **통과**

### U10 — 실 AI 분석 연결  ✅ 완료 (실키 검증)
- [x] `analyzeAndSave()`가 `meeting.transcription`을 `analyzeMeeting`에 실제 전달
- [x] `getMeetingById`가 transcription 조회하도록 수정
- [x] **실 키로 검증**: (a) 메타데이터 분석이 fallback(고정 78) 대신 제목 반영 실제 GPT 결과 산출,
  (b) 오디오 업로드 시 전사문 기반으로 재분석되어 실제 미팅 내용 반영
- **Gate:** 전사문 기반 결과가 메타데이터-only와 유의미하게 다름 → **통과**
- **참고:** 무키/오류 시 자동 fallback 유지 — 파이프라인 항상 완료

> **비용 주의:** 미팅 생성 시마다 GPT 분석 1회 + 오디오 업로드 시 Whisper+GPT 호출 → 실제 과금 발생.
> **보안 주의:** 발급된 OPENAI_API_KEY가 대화에 평문 노출됨 → 파일럿 종료 후 **키 로테이션 권장.**

### U11 — 웹 프론트엔드 배포  ✅ 완료 (브라우저 검증)
- [x] 로그인 페이지 신규(기존에 없어서 401 루프였음) + 인증 가드 + 로그아웃
- [x] `MeetingDetailPage` fetch 버그 수정(리스트 대신 getMeetingById) → 분석 상세 정상 렌더
- [x] **별도 사이트**: nginx 컨테이너 `sep-v2-web`(포트 3082), `/api`→백엔드 프록시(단일 오리진), V1 무관
- [x] 실제 브라우저 검증: 로그인→대시보드(실 AI데이터)→미팅목록→상세(전사기반 분석)→로그아웃→재로그인(이름 표시)
- **접속:** `http://192.168.0.131:3082` (LAN) → **통과**
- 일반 "사용자" 용어 사용(사람을 "영업사원"으로 라벨하지 않음)

### U13 — 사용자/관리자 관리 모델  🔜 신규 추가 (V1 구성 참조)
> 요구: "영업사원"이 아니라 일반 "사용자", **관리자(admin)가 사용자를 관리**하는 구조. 공개 회원가입 없음.
- [ ] 역할 정리: `admin` / `user` (기존 sales_rep/manager 라벨을 일반 사용자 관점으로 정리)
- [ ] 관리자 전용 API: 사용자 생성/목록/비활성화 (admin 권한 미들웨어)
- [ ] 관리자 UI: 사용자 관리 페이지(생성/목록), 일반 사용자에겐 비노출
- [ ] 시드 관리자 계정 분리 + 기본 계정 정리
- **Gate:** 관리자가 새 사용자 생성 → 그 사용자로 로그인 가능; 일반 사용자는 관리 메뉴 접근 불가
- **참고:** V1(`/home/jnh/workspace/SEP`) 사용자/권한 구성 참조

### U12 — 파일럿 수준 보안/운영 정비  ⏳ 대기
- [ ] 기본계정 비밀번호 교체, CORS 화이트리스트(`*` 제거)
- [ ] Postgres 백업 스크립트(cron), 로그 확인, 재시작 정책 점검
- **Gate:** 기본계정 교체 확인 + 백업 파일 생성 확인

> **Phase ③(진짜 상용, 수주 규모)** 는 별도: 공개 도메인+HTTPS, 보안 하드닝(가입/권한/레이트리밋),
> 멀티테넌시, 모니터링/알림, QA/E2E, 녹음 데이터 법적/개인정보 검토, 이중화.

---

# Phase ②+ — 분석 품질 V1 준하게 (A안)

> V1 대비 V2 분석이 얇았던 원인: 모델이 아니라(둘 다 gpt-4o-mini) **다단계 파이프라인/프롬프트/스키마**를
> 단일 호출로 축소했던 것. A안으로 핵심을 V1 수준으로 이식.

### U13 — 사용자/관리자 관리 모델  ✅ 완료
- (위 Phase② 참조에서 정의) admin/user, 관리자 사용자 생성·관리, 라우트 403 가드, 부트스트랩 getMe. maindev 검증 완료.

### U14 — V1식 분석 이식 (A안)  ✅ 완료 (maindev 실오디오 검증)
- [x] STT 화자분리(`gpt-4o-transcribe-diarize`) + whisper 폴백
- [x] 화자 역할 매핑(영업대표/고객, 이름 미추정)
- [x] V1식 리포트: 요약/관심사/우려/딜신호/액션아이템/**팔로업 이메일 초안**
- [x] 대화 지표(코드): 발화비율/단어/턴/질문/WPM
- [x] DB 003: analysis_results 리포트 컬럼 + transcript_segments
- [x] 상세화면: AI요약·관심사·우려·액션·대화지표·팔로업이메일·**화자별 대화**
- [x] 버그픽스: analysis_progress 정수 반올림
- **검증:** 2분 2화자 오디오 → 31세그먼트 영업/고객 분리, 발화 86%/14%, 요약·관심사·우려·액션·이메일 생성 및 브라우저 렌더 확인

### U15 — B안 (코칭/스코어카드/맥락)  🔜 대기
- [ ] 심리+코칭 단계(고객상태·자신감·코칭 방향/준비/체크리스트)
- [ ] 5축 SE 스코어카드(질문/경청/오브젝션/가치전달/클로징, 근거+조언)
- [ ] 이전 미팅 맥락 누적(같은 고객 최근 2건)

### (UI) 홈 대시보드 재구성  ✅ 완료
- 홈이 "최근 미팅 1건"이 아니라 업무 대시보드(지표+성과/코칭+할일/팔로업+최근미팅)로 재구성.
- 미팅 목록 고객명·점수 표시(“-” 문제 해결).

### U16 — 새 미팅 + 오디오 업로드 화면  ✅ 완료 (브라우저 E2E)
- [x] `/upload` 페이지: 제목/고객(자동완성+신규생성)/일시/사전메모/오디오파일
- [x] 제출 시: 고객 resolve → 미팅 생성 → 오디오 업로드 → 진행률 폴링 → 상세 이동
- [x] 홈 CTA·목록 버튼을 업로드 화면에 연결
- **검증:** 브라우저에서 폼 작성 + 실제 2분 WAV 첨부 → 고객·미팅 생성 → 업로드 → STT+분석 →
  완료 상세로 자동 이동. **브라우저만으로 전체 업무 플로우 완결.**

---

## 진행 로그
- 2026-08-07: 계획 수립·저장.
- 2026-08-07: U0~U3 완료 — 백엔드 다수 통합버그 실측·수정, 로컬 DB 영속성 검증 통과(커밋 0446167).
- 2026-08-07: U4~U7 완료 — maindev(`192.168.0.131:3080`)에 상용 구성 배포·스모크테스트 전체 통과.
  Phase ① 종료. Phase ②(U8~U12) 계획 추가.
- 2026-08-07: U8~U10 완료 — 오디오 업로드·Whisper STT·전사기반 GPT 분석을 maindev에서 실 키로 검증.
  실제 2분 오디오 → 한국어 전사 747자 → 실제 미팅내용 반영 분석 확인. 남은 것: U11(웹 프론트), U12(파일럿 보안).
