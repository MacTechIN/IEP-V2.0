# C-5 설계 — 분석 파이프라인을 Workflow 로

- 작성일: 2026-08-08
- 범위: 미팅 분석(STT → 화자 역할 → 세그먼트 → 리포트)을 사내 Express 의 fire-and-forget 에서
  **Cloudflare Workflow 의 내구 실행**으로 옮긴다
- 전제: [Phase C 설계](2026-08-08-phase-c-design.md) §3.5 · C-4b(R2)가 먼저 끝나야 한다

---

## 1. 지금 어떻게 도는가 (실측)

진입점이 셋이고 **전부 응답을 보낸 뒤 `setImmediate` 로 뒷일을 시작한다.**

| 진입점 | 트리거 |
|---|---|
| `startAnalysis()` | 미팅 생성 시 (전사문 없으면 제목만으로) |
| `processAudio()` | `POST /meetings/:id/audio` — 업로드 직후 |
| `analyzeFromRecordings()` | `POST /meetings/:id/analyze` — 선택한 녹음들 |

`processAudio` 의 실제 순서:

```
status=processing, progress=10
  ↓ OpenAIService.transcribeAudio(filePath)      ← 가장 오래 걸린다. 오디오 길이에 비례
  ↓ setTranscription()
  ↓ OpenAIService.mapSpeakerRoles(segments)      ← LLM
  ↓ saveSegments()
  ↓ analyzeAndSave()                             ← LLM (대시보드 점수용)
  ↓ saveDeepAnalysis()                           ← LLM 여러 번 (리포트·심리·코칭·스코어카드)
status=completed, progress=100
```

## 2. Workers 로 그대로 못 옮기는 이유

- **`setImmediate` 가 없다.** 그리고 응답 이후의 작업은 종료된다
- `ctx.waitUntil()` 로 살릴 수는 있으나 **내구성이 없다** — 중간에 죽으면 흔적 없이 사라진다
- STT 는 오디오 길이에 비례해 수 분에서 수십 분이다. 한 요청 안에 담을 수 없다

v1 이 같은 문제를 Workflows 로 풀었다(F-4, 커밋 `bd8d697`). 같은 구조를 가져온다.

---

## 3. 옮기면서 반드시 고쳐야 하는 것

### 3.1 진행률이 가짜다

```ts
const newProgress = Math.min(meeting.analysisProgress + Math.random() * 20, 95);
```

1.5초마다 도는 `setInterval` 이 **난수를 더한다.** 실제 진행과 아무 관계가 없고,
95% 에서 멈춰 있다가 완료되면 100 이 된다. 사용자는 이것을 자기 분석의 진행 상황으로 읽는다.

Workflow 로 옮기면 **단계가 곧 진행률이 된다** — 지어낼 필요가 없어진다.

| 단계 | progress |
|---|---:|
| 대기 | 0 |
| 오디오 확보 | 10 |
| 전사 완료 | 45 |
| 화자 역할·세그먼트 저장 | 60 |
| 기본 분석 저장 | 75 |
| 리포트·심리·코칭·스코어카드 | 95 |
| 완료 | 100 |

`setInterval` 티커는 사라진다. Workers 에 없기도 하지만, **없어야 맞다.**

### 3.2 실패 원인이 남지 않는다

지금은 `catch` 에서 `analysisStatus: 'failed'` 만 쓴다. **왜 실패했는지 아무 데도 없다.**
v1 이 정확히 이것 때문에 고생했고 `analysis_error`·`analysis_stage` 를 넣어 해결했다(v1 진단 F-2).

마이그레이션 `006` 으로 두 컬럼을 추가한다.

```sql
alter table v2.meetings
  add column if not exists analysis_error text,
  add column if not exists analysis_stage text,
  add column if not exists analysis_started_at timestamptz;
```

실패하면 사용자 화면에 **원인과 중단 지점**을 보여준다. "실패했습니다" 만으로는 아무것도 못 한다.

### 3.3 오디오를 R2 에서 읽는다

`transcribeAudio(filePath)` 가 `fs.createReadStream` 으로 로컬 경로를 연다.
Workflow 는 R2 객체를 읽어 `FormData` 에 그대로 넣는다. **C-4b 가 선행 조건인 이유가 이것이다.**

---

## 4. Workflow 구조

```
POST /api/v2/meetings/:id/audio   (Worker)
  ├─ 소유 확인
  ├─ R2 에 업로드
  ├─ meetings.audio_url = R2 키
  ├─ ANALYSIS.create({ meetingId })      ← Service Binding
  └─ 202 즉시 반환
                    │
                    ▼
        ┌───────────────────────────────┐
        │ AnalysisWorkflow              │
        │  step 1  오디오 확보 (R2)      │
        │  step 2  STT + 화자 분리       │
        │  step 3  역할 판정 · 세그먼트   │
        │  step 4  기본 분석             │
        │  step 5  리포트·심리·코칭       │
        │  step 6  완료 표시             │
        └───────────────────────────────┘
```

**각 단계는 독립적으로 재시도된다.** 5단계에서 죽으면 STT 를 다시 하지 않는다 —
지금 구조에서는 처음부터 다시 해야 하고, 그게 곧 돈이다(오디오 1분당 $0.021).

단계 경계는 **비싼 것 앞뒤로** 잡았다. STT 가 가장 비싸고 가장 오래 걸리므로 홀로 한 단계다.

### 재시도 규칙

v1 에서 배운 것을 그대로 적용한다 — **4xx 는 재시도하지 않는다.**
같은 파일로 다시 보내도 같은 결과이고, v1 에서는 이 재시도가 5MB 업로드를 다시 태워
인스턴스를 몇 시간 묶어 둔 적이 있다. 5xx·429·네트워크 오류만 재시도한다.

---

## 5. 세 진입점을 어떻게 정리하나

지금은 셋이 각자 `setImmediate` 를 부른다. Workflow 로 옮기면 **입력이 다를 뿐 같은 일**이다.

| 진입점 | Workflow 입력 |
|---|---|
| 오디오 업로드 | `{ meetingId, source: 'audio', r2Key }` |
| 녹음 선택 분석 | `{ meetingId, source: 'recordings', recordingIds }` |
| 미팅 생성(전사문 없음) | `{ meetingId, source: 'metadata' }` |

step 2(STT)만 `source` 에 따라 달라지고 3~6 은 공통이다.
`metadata` 는 STT 를 건너뛰고 곧장 4 로 간다 — 지금도 전사문 없이 제목만으로 분석한다.

---

## 6. 순서

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| **C-5-1 ✅** | 마이그레이션 `006` (`analysis_error`·`analysis_stage`·`analysis_started_at`) | **적용 완료 (2026-08-08)** |
| **C-5-2+3 ✅** | Workflow + openaiService 이관 | **완료 (2026-08-08) — §10** |
| C-5-4 | 업로드 라우트 2개를 Worker 로 (R2 + Workflow 기동) | 사내 백엔드 없이 업로드→분석 완주 |
| C-5-5 | 진행률을 단계 기반으로 교체, 난수 티커 제거 | 진행률이 실제 단계와 일치 |

**C-5-1 은 지금 할 수 있다** — R2 와 무관하고, 되돌리기도 컬럼 추가라 안전하다.

---

## 7. 이 설계가 건드리지 않는 것

- **오디오 길이 상한 23분 20초.** v2 는 파일을 통째로 보낸다. 그보다 긴 미팅은 지금도 실패한다.
  v1 은 브라우저에서 조각내 올려 풀었다. C-5 범위 밖이지만, Workflow 가 들어오면
  "조각마다 한 단계" 로 확장하기는 쉬워진다
- 실시간 스트림(`/api/v2/stream`) — Phase D

## 8. 아직 모르는 것

- Workflow 한 인스턴스의 최대 수명이 가장 긴 미팅을 감당하는지 (v1 에서는 문제되지 않았다)
- `saveDeepAnalysis` 안의 LLM 호출 횟수와 각각의 소요 — 단계를 더 쪼갤지 판단에 필요하다
- 동시 분석 수. 지금은 아무 제한이 없다

---

## 9. C-5-1 적용 메모 (2026-08-08)

컬럼 3개를 넣었고 앱은 그대로 뜬다. 로그인·화면 모두 이상 없다.

**배포에서 한 번 헛짚었다.** `--build` 없이 `up -d` 를 했더니 migrate 가 "up to date" 를 찍고 끝났다.
Dockerfile 이 `COPY database ./database` 로 **마이그레이션 SQL 을 이미지에 굽는다** —
호스트 파일을 고쳐도 이미지를 다시 만들지 않으면 컨테이너 안에는 옛 파일만 있다.
그래서 006 이 존재하지 않는 것처럼 보였다.

**마이그레이션을 추가하면 반드시 `--build` 를 붙인다.** 볼륨 마운트로 바꾸는 선택지도 있지만,
이미지에 굽는 편이 "배포된 이미지가 곧 스키마 버전" 이라는 성질을 지켜 준다.

---

## 10. C-5-2·C-5-3 실행 결과 (2026-08-08) — Workflow 가 완주한다

**두 단계를 합쳤다.** 원래 C-5-2 는 "Workflow 골격만 만들고 STT 는 사내 것을 호출" 이었는데,
**사내 백엔드는 인터넷에서 보이지 않는다.** Worker 가 부를 방법이 없으므로 순서가 성립하지 않았다.

### 옮긴 것

`openaiService` 의 여섯 함수 — `transcribeAudio`(화자분리 + whisper 폴백), `mapSpeakerRoles`,
`analyzeMeeting`, `generateReport`, `generatePsychCoaching`, `generateScorecard`.

**바꾼 것은 전달 방식뿐이다.**

| | 사내 | Worker |
|---|---|---|
| HTTP | axios | fetch |
| 멀티파트 | form-data (Node 스트림) | 표준 FormData |
| 오디오 | `fs.createReadStream(경로)` | R2 객체의 blob |

**프롬프트·모델·temperature·파싱 규칙은 한 글자도 바꾸지 않았다.** 결과가 달라지면 안 된다.
`computeTalkMetrics`(코드 계산)와 `saveSegments`·`saveReport` 의 SQL 도 그대로다.

### 검증 — 버리는 미팅 하나로 전 경로

기존 데이터를 건드리지 않으려고 미팅을 새로 만들어 돌리고 지웠다.

**성공 경로** (R2 의 127KB webm)

```
pending → 리포트·코칭 생성 중(95) → 완료(100)
```

기록된 것: 전사 40자 · 세그먼트 1건 · 요약 · 스코어카드 46점 ·
심리 인사이트 · 대화 지표 · 화자 역할 `{"A":"영업대표"}`.

**실패 경로** (없는 R2 키)

```
failed | R2 에 객체가 없습니다: meetings/does-not-exist.webm
```

**원인이 DB 에 남는다.** 사내 백엔드는 `status='failed'` 만 쓰고 이유는 컨테이너 로그에만 뒀는데,
그 로그는 재생성하면 사라진다. 이제 화면에 무엇이 잘못됐는지 띄울 수 있다.

### 진행률이 진짜가 됐다

단계가 곧 진행률이다. `Math.random()` 티커는 옮기지 않았다 —
Workers 에 `setInterval` 이 없어서가 아니라, **없어야 맞아서** 없앴다.

### 중복 실행 가드

`POST /meetings/:id/analyze` 는 `analysis_started_at` 이 30분 이내이고 `processing` 이면 409 를 준다.
**status 가 아니라 시작 시각으로 판단한다** — status 로 보면 사용자가 화면에서 초기화한 순간 가드가 뚫린다(v1 F-1).

### 남은 것

- **C-5-4**: 업로드 라우트 2개를 Worker 로. 그때 R2 경로로 DB 를 전환하고 그 사이 새 파일을 동기화한다
- **C-5-5**: 프런트엔드가 새 진행률·오류 필드를 읽도록 (지금은 백엔드만 준비된 상태다)
- R2 객체가 없을 때도 2회 재시도한다. 없는 파일은 다시 시도해도 없다 — 4xx 규칙처럼 즉시 실패로 두는 편이 낫다
