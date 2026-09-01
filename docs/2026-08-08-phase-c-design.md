# Phase C 설계 — HTTP API 를 Worker 로

- 작성일: 2026-08-08
- 결정(2026-08-08 갱신): **Postgres 를 관리형으로 옮기고 Hyperdrive 로 붙는다.**
  스키마·SQL·마이그레이션 5개는 그대로 쓴다. 옮기는 것은 **데이터가 있는 위치**뿐이다.
  → 왜 바꿨는지는 §11
- 전제: [이식 준비](2026-08-08-cloudflare-readiness.md) · [Phase B 절차](2026-08-08-phase-b-runbook.md)
- 범위: `/api/v2/*` 의 **HTTP 경로만.** WebSocket 스트림은 손대지 않는다 (Phase D)

---

## 1. 옮기는 것과 남기는 것

```
                    ┌──────────────────────────────────────────┐
 브라우저 ─── HTTPS ─┤ Pages  (SPA)                             │  ← Phase B
                    └──────────────────────────────────────────┘
                              │ /api/v2/*
                              ▼
                    ┌──────────────────────────────────────────┐
                    │ Worker  (Hono)                           │  ← Phase C, 이 문서
                    │   · 라우트 11개 · 미들웨어 4개             │
                    │   · Hyperdrive → Postgres                │
                    │   · R2 → 업로드 파일                      │
                    │   · Workflow 로 분석 디스패치              │
                    └──────────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┬────────────────────┐
                    ▼                    ▼                    ▼
              Postgres(사내)        R2 버킷           Workflow (분석)
                    ▲
                    │ 그대로 유지
        ┌───────────────────────┐
        │ Express 백엔드 (사내)   │  ← WebSocket `/api/v2/stream` 만 남는다 (Phase D)
        └───────────────────────┘
```

**핵심: 이 단계가 끝나면 사내 서버에는 WebSocket 게이트웨이 하나만 남는다.**

---

## 2. 실측한 규모

| 대상 | 크기 |
|---|---|
| 라우트 11개 | 886줄 (`meetings.ts` 204줄이 가장 크고, 나머지는 48~106줄) |
| 미들웨어 4개 | 127줄 (`auth` 50 · `errorHandler` 44 · `requestLogger` 21 · `adminAuth` 12) |
| 마운트 구조 | `/api/v2/<name>` 11개. `auth` 만 공개, 나머지는 `authMiddleware`, `admin` 은 `requireAdmin` 추가 |
| 서비스 9개 | DB 접근은 전부 `utils/database.ts` 의 `query`/`queryOne`/`withTransaction` 을 거친다 |

**마운트가 단정하고 DB 접근이 한 곳으로 모여 있다.** 이 두 가지 때문에 변환이 기계적이다.

---

## 3. 조각별 설계

### 3.1 Express → Hono

Hono 를 고른 이유는 미들웨어·라우팅 형태가 Express 와 가장 닮아 변환이 치환에 가깝기 때문이다.

| Express | Hono |
|---|---|
| `router.get('/:id', handler)` | `app.get('/:id', handler)` |
| `req.params.id` | `c.req.param('id')` |
| `req.body` | `await c.req.json()` |
| `res.status(404).json(x)` | `c.json(x, 404)` |
| `req.user` (global 선언 확장) | `c.get('user')` + `Variables` 타입 |
| `app.use(mw)` | `app.use('*', mw)` |
| `next(err)` → `errorHandler` | `app.onError(handler)` |
| `express.json({limit:'100mb'})` | 불필요 — 본문은 필요할 때 읽는다 |

**`req.user` 확장이 유일하게 성가시다.** 지금은 `declare global { namespace Express }` 로 붙어 있어
파일 전체가 Express 타입에 묶인다. Hono 의 `Variables` 제네릭으로 옮기면 타입이 명시적이 된다.

미들웨어 4개는 그대로 옮긴다 — `requestLogger` 는 `console` 로, `errorHandler` 는 `app.onError` 로.

### 3.2 pg.Pool → Hyperdrive

가장 싼 부분이다. `utils/database.ts` 의 **연결 생성부만** 바꾸면 `query`/`queryOne`/`withTransaction`
시그니처가 그대로 유지되고, **서비스 9개는 한 줄도 안 바뀐다.**

```ts
// 지금:  new Pool({ host: DB_HOST, ... })
// 이후:  new Pool({ connectionString: env.HYPERDRIVE.connectionString })
```

- Hyperdrive 가 연결 풀링을 대신하므로 `min`/`max` 설정은 의미가 없어진다
- `pool` 을 모듈 전역에 캐시하는 지금 방식은 Worker 요청 단위 수명과 맞지 않는다 —
  요청마다 만들고 `ctx.waitUntil(pool.end())` 로 정리하는 형태로 바꾼다
- **마이그레이션은 Worker 가 돌리지 않는다.** Phase A 에서 이미 분리해 뒀다. 그대로 CLI 로 돌린다

Hyperdrive 는 **관리형 Postgres 의 공개 TLS 엔드포인트**를 향한다.
사내 Postgres 를 밖에서 닿게 만드는 문제 자체가 없어졌다 (§11).

### 3.3 multer diskStorage → R2

건드릴 지점이 정확히 8곳이다.

| 위치 | 지금 | 이후 |
|---|---|---|
| `routes/recordings.ts`·`meetings.ts`·`risk.ts` | `multer.diskStorage` → `UPLOAD_DIR` | `await c.req.formData()` → `env.BUCKET.put(key, file.stream())` |
| `services/openaiService.ts` 133·158·257 | `fs.createReadStream(filePath)` | `(await env.BUCKET.get(key)).body` |
| `services/recordingService.ts:94`·`routes/risk.ts:44` | `fs.unlinkSync` | `env.BUCKET.delete(key)` |

- DB 의 `storage_path` 는 **로컬 경로에서 R2 객체 키로 의미가 바뀐다.** 컬럼은 그대로 두고 값만 바뀐다
- 키 규칙은 지금 파일명 규칙(`rec-<ts>-<rand><ext>`)을 유지하되 앞에 소유자 구분을 붙인다:
  `recordings/<meeting_id>/rec-<ts>-<rand><ext>`
- 업로드 상한 100MB 는 유지한다. Worker 는 요청 본문을 스트림으로 R2 에 넘길 수 있어 메모리에 다 담지 않는다
- **기존 파일 이전이 필요하다.** 사내 `uploads` 볼륨의 내용을 R2 로 한 번 옮기고
  `storage_path` 를 새 키로 갱신한다. 이건 일회성 스크립트다 (§6 3단계)

`openaiService` 는 `axios` + `form-data`(Node 스트림) 를 쓴다. Workers 에서는 표준 `fetch` + `FormData` 로
바꾼다 — R2 객체의 `body` 를 그대로 `FormData` 에 넣을 수 있어 오히려 짧아진다.

### 3.4 인증 — jsonwebtoken → jose, 그리고 bcrypt 주의

`jsonwebtoken` 은 Node crypto 에 의존한다. Workers 에서는 **`jose`** 로 바꾼다 (WebCrypto 기반).
`jwt.sign`/`jwt.verify` 호출부는 `authService.ts` 안에 모여 있어 범위가 좁다.

**`bcrypt.compareSync` 는 그대로 둔다 — 실측했고 통과다.** (§10)
`PBKDF2` 전환과 점진적 재해싱은 필요 없다.

### 3.5 (최대 난관) 백그라운드 분석 — `setImmediate` → Workflow

`meetingService.ts` 250·267·305 세 곳이 **응답을 보낸 뒤** `setImmediate` 로 분석을 돌린다.

```ts
setImmediate(async () => { await this.analyzeAndSave(meetingId); });
```

Workers 에는 `setImmediate` 가 없고, 더 중요하게는 **응답 이후의 작업이 그대로 종료된다.**
`ctx.waitUntil()` 로 살릴 수는 있지만 그것도 한도가 있고 **내구성이 없다** — 중간에 죽으면 흔적 없이 사라진다.
STT + 분석은 오디오 길이에 비례해 수 분에서 수십 분이 걸린다.

**v1 이 정확히 이 문제를 겪었고 Cloudflare Workflows 로 풀었다**(F-4, 커밋 `bd8d697`).
같은 구조를 그대로 가져온다.

- Worker 는 분석 요청을 받으면 **즉시 202 를 반환**하고 Service Binding 으로 Workflow 를 깨운다
- Workflow 가 단계별로 내구 실행한다 (전사 → 분석 → 저장). 중간 실패는 그 단계부터 재시도된다
- 진행 상태는 DB 컬럼으로 노출한다. v1 의 `analysis_stage`·`analysis_error` 와 같은 방식

**이 부분만은 치환이 아니라 재설계다.** Phase C 안에서 가장 큰 덩어리이고, 여기서 시간이 든다.

### 3.6 로깅

`winston` 을 걷어내고 `console` 로 간다. 수집은 Logpush 로 붙인다.
`utils/logger.ts` 인터페이스(`logger.info`/`error`)를 유지하는 얇은 대체물을 두면 호출부는 안 바뀐다.

---

## 4. 남기는 것 — WebSocket

`services/streamGateway.ts` 는 **그대로 사내 백엔드에 남는다.** Phase B 의 터널이 이미 그 경로를 열어 준다.
Worker 로 옮기는 것은 Durable Object 재설계라 Phase D 다.

즉 Phase C 가 끝난 사내 백엔드는 **WebSocket 전용 프로세스**가 된다. Express 는 남지만 라우트는 비어 있다.

---

## 5. 이 설계가 건드리지 않는 기존 결함

정직하게 적어 둔다. Phase C 로 저절로 낫지 않는다.

- **오디오 길이 상한.** v2 는 파일을 통째로 STT 에 보낸다(`chunking_strategy: auto`).
  `gpt-4o-transcribe-diarize` 의 입력 한도는 **1400초(23분 20초)** 이고 문서에 없이 400 으로만 드러난다.
  23분이 넘는 미팅은 지금도 실패한다. v1 은 브라우저에서 조각내 올리는 방식으로 풀었다
- **분석 실패 원인이 남지 않는다.** v1 의 `analysis_error`·`analysis_stage` 에 해당하는 것이 없다.
  Workflow 로 옮기면 어차피 상태 컬럼이 필요하므로, 그때 함께 넣는 것이 자연스럽다

---

## 6. 순서

각 단계가 끝날 때마다 **되돌릴 수 있는 지점**이 되도록 쪼갰다.
갈래 2 로 바뀌면서 **DB 이전이 맨 앞으로 왔고, Phase B(화면)가 뒤로 갔다** — 이유는 §11.

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| **C-0 ✅** | 관리형 Postgres 생성 → 데이터 이전 → **사무실 백엔드가 새 DB 를 보게 전환** | **완료 (2026-08-08) — §12** |
| **C-1 ✅** | Worker 뼈대 + Hyperdrive. `/health` 와 읽기 라우트 1개만 | **완료 (2026-08-08) — §13** |
| **C-2 ✅** | 미들웨어 4개 + 인증 라우트를 Hono 로. `jose` 전환 | **완료 (2026-08-08) — §14** |
| **C-3 ✅** | customers · users · actions 이관 | **완료 (2026-08-08) — §15.** dashboard·analytics·risk 는 재배치 |
| **C-4a ✅** | 미팅 읽기 · dashboard · analytics | **완료 (2026-08-08) — §16** |
| **C-4b ✅** | `/risk` 이관 + R2 버킷·파일 18개 이전 | **완료 (2026-08-08) — §17·§18** |
| **C-5 ✅** | 분석을 Workflow 로 | **완료** — C-5 설계 문서 §10 참고 |
| **B ✅** | SPA 를 Pages 로 | **완료 (2026-08-08) — §19** |
| **D ✅** | WebSocket 스트림을 Durable Object 로 | **완료 (2026-08-09) — §20** |

**C-0 이 특히 중요하다.** DB 만 옮기고 나머지는 그대로 두므로,
**새 DB 가 실제로 멀쩡한지 Worker 를 한 줄도 쓰기 전에 확인**할 수 있다.
문제가 있으면 `.env.production` 의 DB 주소를 되돌리면 끝이다.

C-1 부터 C-5 까지는 사내 백엔드와 병행 운영이 가능하다. 경로 단위로 옮기고,
문제가 생기면 그 경로만 nginx 프록시로 되돌린다.

## 7. 인프라 선행 작업 — 없다

이전 판에서는 "Hyperdrive 가 사내 Postgres 에 닿아야 한다" 가 선행 과제였고,
그래서 터널과 도메인이 필요했다. **DB 를 관리형으로 옮기기로 하면서 이 항목이 통째로 사라졌다.**

- 화면: `*.pages.dev` (무료)
- API: `*.workers.dev` (무료 — 이 계정의 `wooriszhome` 서브도메인은 이미 살아 있다)
- DB: 관리형 Postgres 의 공개 TLS 엔드포인트

**도메인도 터널도 필요 없다.** 도메인은 나중에 보기 좋은 주소를 원할 때 붙이는 것이지 착수 조건이 아니다.

## 8. 위험

| 위험 | 대응 |
|---|---|
| ~~사내 Postgres 가 죽으면 Worker 도 같이 죽는다~~ | **해소.** DB 가 사무실을 떠나므로 사내 단일 장애점이 없어진다 |
| 이전 중 데이터 유실 | 9MB · 최대 테이블 155행이라 덤프·복원이 수 초다. 원본은 지우지 않고 남긴다 (§11) |
| ~~bcrypt 가 Worker CPU 한도를 넘음~~ | **해소.** 실측 결과 로그인 1회가 한도의 약 6% 다 (§10) |
| 파일 이전 중 `storage_path` 불일치 | 이전 스크립트를 **읽기 우선**으로 짠다 — R2 에 없으면 로컬을 본다. 양쪽이 맞은 뒤 로컬을 지운다 |
| Workflow 가 v1 과 다른 계정 한도에 걸림 | 같은 계정이다. v1 이 이미 돌고 있으므로 한도 자체는 확인된 셈이다 |

---

## 9. 아직 모르는 것

- ~~bcrypt 라운드 수와 Worker CPU 실측값~~ → **§10 에서 실측 완료. 통과.**
- ~~사내 `uploads` 볼륨의 실제 용량~~ → **실측 62.8MB · 파일 18개.** R2 이전은 몇 분이고 비용은 무시 가능
- Workers 요금제. Durable Objects 와 Workflows 사용 가능 여부가 여기 걸린다
- 관리형 Postgres 의 지역(region)과 Worker 사이 지연 — 서울 리전이 있는 제공자를 고르면 줄어든다

---

## 10. bcrypt CPU 실측 (2026-08-08) — **통과**

C-2 의 게이트였다. 넘었으면 해시 재작성이 필요해 일정이 바뀌는 항목이라 먼저 쟀다.

**대상**: 운영 DB 의 해시는 전부 `$2a$10$` — cost factor **10**, 사용자 3명.
코드도 `authService.ts:168` 에서 `bcrypt.hashSync(password, 10)` 이다. `bcryptjs` 2.4.3.

| 환경 | 연산당 |
|---|---:|
| Node 24 (x64, 로컬) | 60.2 ~ 60.8ms |
| workerd (`wrangler dev --local`) | 62.6ms |
| **Cloudflare 엣지 (실배포)** | **92 ~ 103ms** |

일치·불일치가 같은 비용이다(bcrypt 는 어차피 해시를 전부 계산한 뒤 비교한다).
n=1·2·5·10·20 이 선형이라 측정에 이상은 없다.
**엣지가 로컬보다 약 1.5배 느리다** — 로컬 수치만 믿었으면 과소평가했을 부분이다.

### 이 계정의 CPU 한도

임시 Worker 를 실제로 배포해 한도를 좁혔다 (측정 후 삭제, 잔존 확인함).

| 연산 수 | 추정 CPU | 결과 |
|---:|---:|---|
| 1 | ~92ms | 200 |
| 10 | ~783ms | 200 |
| 20 | ~1,672ms | 200 |
| 40 | ~3,300ms | **503 · error 1102 (CPU 한도 초과)** |
| 100 | ~10,300ms | 503 · 1102 |

**한도는 약 1.7초와 3.3초 사이다.**
Free 플랜의 10ms 제한은 확실히 적용되지 않는다 — 92ms 단일 연산이 통과했다.

### 판정

**로그인 1회 = 약 0.1초 CPU = 측정된 한도의 약 6%.**
같은 요청 안에서 bcrypt 를 **약 17회** 연속으로 돌려야 한도에 닿는다. 로그인은 1회다.

- PBKDF2 전환 불필요, 기존 해시 그대로 유지
- 점진적 재해싱 불필요 — C-2 일정이 늘어나지 않는다
- 비용도 문제가 아니다: CPU 밀리초 과금 기준 로그인 1회가 백만분의 몇 달러 수준이다

**단, cost factor 를 올리면 비용이 지수로 늘어난다.** 10 → 12 는 4배(약 0.4초)다.
보안 강화 목적으로 올릴 일이 생기면 이 측정을 다시 해야 한다.

---

## 11. 왜 갈래 2 로 바꿨나 (2026-08-08)

처음 계획은 "DB 는 사무실에 그대로, Hyperdrive 로 붙는다" 였고, 그래서 터널이 필요했고
터널의 공개 호스트명 때문에 **도메인이 착수 조건**이 됐다. 도메인이 없어 Phase B 가 멈췄다.

멈춘 자리에서 나온 질문이 판을 바꿨다 — **"v1 처럼 Cloudflare 가 주는 주소를 쓰면 안 되나?"**

맞는 지적이었다. Cloudflare 는 **자기 위에서 도는 것**에는 무료 주소를 준다.

| 무엇 | 주소 | 도메인 필요? |
|---|---|---|
| SPA | `*.pages.dev` | 아니오 |
| API (Worker) | `*.workers.dev` | 아니오 |
| 사무실 서버 | 없음 — 터널을 뚫어야 하고, 이름을 붙이려면 zone 이 필요 | **예** |

즉 도메인이 필요했던 원인은 **"기존 백엔드를 사무실에 남겨둔다"는 선택 하나**였다.
API 가 Worker 가 되는 순간 그 요구가 사라진다.

남는 것은 DB 하나였고, 두 갈래였다.

| | 뜻 | 판단 |
|---|---|---|
| 갈래 1 | DB 는 사무실에 두고 터널 사설 네트워크로 Hyperdrive 연결 | 도메인 없이 될 가능성은 있으나 **미확인** |
| **갈래 2** | DB 도 관리형으로 이전 | 터널·도메인 **불필요**, 사내 단일 장애점 제거. 이전 작업 한 번 |

**갈래 2 를 택했다.** 규모가 작아서 이전 비용이 거의 없다 — DB 9MB(최대 테이블 155행),
업로드 62.8MB(파일 18개), 사용자 3명.

### 이전 원칙

- **원본을 지우지 않는다.** 사무실 Postgres 컨테이너와 볼륨은 그대로 남긴다.
  되돌리기는 `.env.production` 의 DB 주소를 바꾸는 것뿐이다
- 스키마는 손대지 않는다. `pg_dump` → 복원 → **테이블별 행 수 대조**로 확인한다
- `schema_migrations`(5행)도 함께 옮긴다. 안 옮기면 새 DB 에서 마이그레이션이 다시 돌아 충돌한다
- 제공자 선택 기준은 **Postgres 15 호환**과 **서울 리전 유무**다. 리전이 멀면 Worker 왕복이 그만큼 늘어난다

---

## 12. C-0 실행 결과 (2026-08-08) — 완료

Neon(Postgres **17.10**, ap-southeast-1)으로 옮기고 사무실 백엔드를 그쪽으로 돌렸다.
**원본은 지우지 않았다.**

| 테이블 | 행 |
|---|---:|
| `v2.transcript_segments` | 155 |
| `v2.sessions` | 38 |
| `v2.customers` | 16 |
| `v2.meetings` | 15 |
| `v2.analysis_results` | 14 |
| `v2.meeting_recordings` | 13 |
| `v2.users` | 3 |
| `public.schema_migrations` | 5 |

전 테이블 행 수가 원본과 일치했다. 나머지 6개 테이블은 양쪽 다 0행이다.

### 정말 옮겨갔는지 어떻게 확인했나

`migrate` 컨테이너가 "up to date" 를 찍는 것만으로는 **증명이 안 된다** —
사내 DB 에도 같은 5행이 있어서 어느 쪽에 붙었든 같은 로그가 나온다.

그래서 DB 를 반드시 건드리는 요청(로그인 시도 → `v2.users` 조회)을 보낸 뒤 양쪽 접속을 셌다.

| | 접속 수 |
|---|---:|
| 사내 Postgres | **0** |
| Neon | **1** |

이게 판정 근거다.

### SSL 모드를 고정했다

첫 기동에서 node-postgres 가 경고를 냈다 — `sslmode=require` 를 **지금은** `verify-full` 로
강하게 해석하지만, 다음 메이저(pg v9)부터 libpq 의미를 따라 **검증이 약해진다**는 내용이다.
그대로 두면 라이브러리 업그레이드만으로 조용히 약해지므로 `sslmode=verify-full` 로 명시했다.
재기동 후 경고가 사라졌고 동작은 같다.

### 되돌리는 법

`deploy/.env.production` 의 `DATABASE_URL` 한 줄을 지우고 backend 를 재기동하면 사내 DB 로 돌아간다.
같은 디렉터리에 `.env.production.bak-20260808-200846` 백업이 있다.

**원본 Postgres 컨테이너와 볼륨은 그대로 둔다.** 며칠 운영해 본 뒤에 정리 여부를 정한다.

### 확인 결과

| 항목 | 결과 |
|---|---|
| `/health` | 200 |
| 로그인(없는 계정) | 401 — DB 조회가 실제로 일어난다 |
| 웹 화면 | 200 |
| 사내 Postgres 의존 | 백엔드에서 **끊김** (아직 컨테이너는 떠 있음) |

---

## 13. C-1 실행 결과 (2026-08-08) — Worker 가 Neon 을 읽는다

`worker/` 를 새로 만들고 `https://sep-v2-api.wooriszhome.workers.dev` 에 배포했다.
**도메인 없이 Cloudflare 가 주는 주소를 그대로 쓴다** — §11 에서 정한 그대로다.

| 경로 | 동작 |
|---|---|
| `GET /health` | 공개. `{ok:true}` 만 반환한다 — 버전도 구성도 알리지 않는다 |
| `GET /api/v2/_probe/db` | **비공개.** `x-probe-secret` 헤더가 맞아야 한다. 틀리면 404 로 **존재 자체를 숨긴다** |
| 그 외 | 404. 사내 백엔드가 처리 중이라는 사실을 알리지 않는다 |

### 확인된 것

프로브가 돌려준 행 수가 이전한 데이터와 정확히 일치한다 —
`meetings` 15, `customers` 16, `users` 3, `transcript_segments` 155.

| 항목 | 값 |
|---|---:|
| 성공률 | 10/10 |
| DB 시간 (중앙) | **365ms** (최소 329 / 최대 405) |
| 전체 왕복 (중앙) | 521ms |

**이 365ms 가 Hyperdrive 를 쓰는 이유다.** 지금은 요청마다 새 연결을 연다 —
싱가포르까지 TLS 핸드셰이크와 Postgres 인증을 매번 다시 하는 값이지 쿼리 시간이 아니다.
Hyperdrive 가 연결을 재사용하면 여기서 크게 줄어야 한다. **줄었는지 이 수치와 비교해 판정한다.**

### 배포 직후 10분쯤 불안정하다

처음 측정에서 8회 중 2회가 `error code 1042` (HTTP 404) 로 실패했다.
DB 를 쓰지 않는 `/health` 도 같은 비율로 실패해, 우리 코드가 아니라 **workers.dev 라우트 전파** 문제였다.
잠시 뒤 30회 연속 200 이었다. 배포 직후 측정한 수치는 믿지 말 것.

### Hyperdrive 연결 — 붙였고, 코드는 한 줄도 안 바뀌었다

토큰에 **Account → Hyperdrive → Edit** 권한을 추가한 뒤 `sep-v2-db`
(`28586072129244f588d3070628f72319`) 를 만들어 바인딩했다.
`connectionString()` 이 `env.HYPERDRIVE` 를 먼저 보므로 **소스 변경 없이** 프로브 응답의
`via` 가 `direct` → `hyperdrive` 로 바뀌었다. 그게 전환 확인 방법이다.

| 구성 | DB 시간(중앙) | 전체 왕복 | 기준 대비 |
|---|---:|---:|---:|
| 직접 연결 (기준) | 365ms | 521ms | — |
| Hyperdrive + 캐시 | 43ms | 186ms | **−88%** |
| **Hyperdrive 캐시 끔 (채택)** | **72ms** | 210ms | **−80%** |

### 캐시는 껐다 — 이득의 대부분은 연결 재사용에서 나온다

Hyperdrive 는 기본으로 SELECT 결과를 캐시한다(기본 60초). 켜 두면 72ms → 43ms 로 29ms 더 빨라진다.
**그 29ms 를 위해 최대 60초 낡은 데이터를 보여줄 수는 없다** —
미팅을 만들고 목록을 새로고침했는데 안 보이는 것이 이 앱에서 가장 흔한 동작이다.

수치가 그 판단을 뒷받침한다. **연결 재사용만으로 이미 80% 를 얻는다.**
캐시를 끄자 최소값이 4ms 에서 40ms 로 올라갔는데, 그 4ms 가 캐시 적중이었다는 뜻이다.

나중에 진짜 정적인 조회(벤치마크 집계 등)가 생기면 그때 다시 검토한다.
지금 설정은 `caching.disabled = true` 다.

### 설계 메모 — 요청마다 연결을 만든다

사내 백엔드처럼 모듈 전역에 풀을 캐시하지 않는다. Worker 는 요청 사이에 살아 있다는 보장이 없고,
살아 있어도 다른 요청과 공유하면 안 된다. **연결 재사용은 Hyperdrive 의 일이다.**

---

## 14. C-2 실행 결과 (2026-08-08) — 인증이 Worker 에서 돈다

미들웨어 4개와 `/api/v2/auth` 3개 라우트를 옮겼다. `jsonwebtoken` → `jose`(WebCrypto).

| 사내 백엔드 | Worker |
|---|---|
| `middleware/auth.ts` | `requireAuth` |
| `middleware/adminAuth.ts` | `requireAdmin` |
| `middleware/requestLogger.ts` | `requestLogger` (winston → console) |
| `middleware/errorHandler.ts` | `app.onError` |
| `routes/auth.ts` + `services/authService.ts` | `routes/auth.ts` |

### 토큰이 양쪽에서 통한다 — 이게 병행 운영의 전제다

C-3~C-5 동안 어떤 경로는 Worker 가, 어떤 경로는 사내 백엔드가 처리한다.
한쪽에서 로그인하고 다른 쪽 API 를 부르는 일이 반드시 생기므로 **클레임 구성을 그대로 맞췄다** —
`{sub, email, role, iat, exp}`, HS256, 같은 `JWT_SECRET`.

| 시험 | 결과 |
|---|---|
| Express 발급 토큰 → Worker `/api/v2/me` | **200** |
| Worker 발급 토큰 → Express `/api/v2/meetings` | **200** (15건) |

양방향 모두 통과했다. 여기가 어긋났다면 "어떤 화면은 로그인이 풀린다" 는
재현하기 까다로운 증상이 됐을 것이다.

### 가드와 세션

| 시험 | 결과 |
|---|---|
| 토큰 없이 `/me` | 401 |
| 위조 토큰 | 401 (만료인지 위조인지 구분해 주지 않는다) |
| 일반 사용자 → `/admin/_ping` | 403 |
| refresh → 새 access 발급 | 200, 이전 토큰과 다름 |
| 로그아웃 후 refresh | **401** |

**로그아웃을 실제로 구현했다.** 사내 백엔드는 `// TODO: 세션 무효화 로직` 만 있고 아무것도 하지 않았다.
refresh 가 `v2.sessions` 를 확인하므로, 세션을 안 끊으면 **로그아웃해도 리프레시 토큰이 30일간 살아 있다.**
(발급된 access 토큰은 만료까지 유효한 것이 정상이다 — 최대 1시간)

### 계정 존재 여부가 응답으로 드러나던 것을 막았다

사내 백엔드는 로그인 실패 시 `details.error` 에 `Invalid password` 와 `User not found` 를
그대로 실어 보냈다. 화면에 쓰이지도 않으면서 **어떤 이메일이 가입돼 있는지 확인할 수 있는 값**이다.

Worker 는 처음부터 같은 응답을 준다. 그리고 **사내 백엔드도 같이 고쳤다** —
프런트엔드가 아직 그쪽을 쓰고 있어 실제로 노출 중인 문제였기 때문이다.
재배포 후 두 경우 응답이 바이트 단위로 같은 것을 확인했다.

---

## 15. C-3 실행 결과 (2026-08-08) — 그리고 묶음을 바로잡았다

### 원래 묶음이 틀렸다

C-3 을 "dashboard·analytics·customers·users·actions·risk" 로 잡았는데 코드를 읽으니 맞지 않았다.

- **`risk` 는 읽기 라우트가 아니다.** `multer.diskStorage` 로 오디오를 받는 업로드 라우트다 → **C-4**
- **`dashboard`·`analytics` 는 둘 다 `meetingService`(501줄)에 의존한다.**
  그 서비스는 C-4·C-5 에서 어차피 옮긴다. 지금 반쪽만 떼어내면 같은 코드를 두 번 만지게 된다 → **C-4**

그래서 C-3 은 **자족적인 셋** — `customers`·`users`·`actions` 로 확정했다.

### 옮긴 결과가 원본과 같은가

같은 토큰으로 양쪽을 불러 비교했다.

| 경로 | Worker | Express |
|---|---|---|
| `/api/v2/customers` | 200 · 16건 | 200 · 16건 |
| `/api/v2/users/me` | 200 | 200 |
| `/api/v2/actions` | 200 · 0건 | 200 · 0건 |

키 집합·첫 레코드·`meta`(`total/limit/offset/hasMore`)까지 동일했다.

### 옮기면서 막은 것 — 실제로 뚫려 있었다

**고객 IDOR.** 목록은 `user_id` 로 걸러내는데 **단건 조회·수정·삭제는 걸러내지 않았다.**
목록에 없는 남의 고객을 ID 로 읽고 고칠 수 있었다.

임시 계정을 만들어 실제로 재현했다(테스트 후 삭제).

| | 남의 고객 조회 | 남의 고객 수정 |
|---|---|---|
| Worker (이관 후) | **404 차단** | **404 차단** |
| Express (수정 전) | **200 — 회사명 노출** | **200 — notes 가 실제로 바뀜** |

추측이 아니라 **쓰기까지 통했다.** 그래서 Express 도 같이 고쳐 배포했다 —
프런트엔드가 아직 그쪽을 쓰므로 살아 있는 노출이었다.
없는 것과 권한 없는 것을 모두 404 로 돌려준다. 존재 여부 자체가 정보이기 때문이다.

**액션 범위.** 원본 `getActions()` 에는 사용자 조건이 **아예 없었다** — 모든 사용자가 모든 액션을 봤다.
액션은 미팅에 속하고 미팅에 `user_id` 가 있으므로 그 경로로 좁혔다
(내 미팅의 액션 또는 나에게 배정된 것, 관리자는 전부).
지금 `v2.action_items` 가 0행이라 보이는 동작은 달라지지 않는다.

**액션 생성 대상.** 내 미팅에만 액션을 달 수 있게 했다. 원본에는 이 검사가 없었다.

**`role` 자체 승격 차단.** `PATCH /users/me` 는 화이트리스트(name·department·monthlyTargetKrw)만 반영한다.
본문에 `role: "admin"` 을 실어 보내도 무시된다.

### 테스트 중 데이터를 건드렸다

IDOR 증명 과정에서 **Express 쪽 PATCH 가 실제로 통해** 고객 '풀분석검증3' 의 `notes` 가
`INTRUSION` 으로 바뀌었다. 다른 고객이 전부 `notes = null` 인 것을 확인하고 null 로 되돌렸다.
읽기만으로 끝냈어야 했다 — 살아 있는 데이터에 쓰기를 시험한 것은 과했다.

---

## 16. C-4a 실행 결과 (2026-08-08) — 미팅 읽기·대시보드·통계

9개 경로를 옮겼고 **전부 사내 백엔드와 응답이 같다**(같은 토큰으로 양쪽 호출, 상태코드·본문 전체 비교).

`/meetings`, `/meetings/:id`, `/analysis/meeting/:id`, `/analysis/meeting/:id/transcript`,
`/dashboard/{home,score,insights}/me`, `/analytics/{summary,trends}`

### 없는 경로를 만들 뻔했다

처음에 분석 결과를 `/meetings/:id/analysis`, 녹취를 `/meetings/:id/segments` 로 만들었다.
**사내 백엔드의 실제 경로는 `/analysis/meeting/:id` 와 `.../transcript` 다** —
`routes/analysis.ts` 에 있어서 미팅 라우트만 보다가 놓쳤다.
프런트엔드가 부르지 않는 주소를 새로 만든 셈이라 되돌렸다.
분석이 아직 없을 때 **202** 를 주는 동작까지 원본 그대로 맞췄다(오류가 아니라 진행 중이라는 뜻이다).

### N+1 을 없앴다 — 5.7배

`getUserScore` 는 미팅을 최대 100건 가져온 뒤 **건마다 분석을 따로 조회했다.**
사내 서버는 풀이 살아 있어 티가 덜 났지만, Worker 는 요청마다 연결을 열기 때문에 그대로 옮길 수 없었다.
조인 한 번으로 바꿨다.

| | `/dashboard/score/me` 중앙 |
|---|---:|
| Worker (조인 1회) | **212ms** |
| Express (N+1, 미팅 15건 → 16질의) | 1,200ms |

둘 다 같은 Neon 을 보므로 순수한 질의 수 차이다. 미팅이 늘수록 격차가 커진다.

### 미팅 IDOR — 고객보다 무거웠다

`getMeetingById` 에도 소유권 검사가 없었다. 고객과 같은 구멍이지만 이쪽이 더 나쁘다 —
**미팅에는 녹취 전문과 분석 결과가 들어 있다.** 조회·수정·삭제, 그리고
`/analysis/meeting/:id` 와 `/transcript` 까지 전부 ID 만 맞으면 통했다.

Worker 는 처음부터 막았고, **Express 도 같이 고쳐 배포했다** — 프런트엔드가 아직 그쪽을 쓴다.
없는 것과 권한 없는 것을 모두 404 로 돌려준다.

### 화면에 지어낸 숫자가 들어 있다

옮기면서 발견했다. 고치지 않고 **원본 그대로 옮긴 뒤 코드에 표시만 남겼다** — 제품 판단이 필요한 부분이다.

| 위치 | 내용 |
|---|---|
| `/dashboard/score/me` | `teamAverageScore: 300` 고정. 순위는 `userRank: 2, totalUsers: 50` 고정이고 **'이순신'·'강감찬' 은 존재하지 않는 사람**이다 |
| 같은 곳 | `weeklyRank`·`monthlyRank` 가 항상 2. `actionCompletionRate` 는 항상 0.82 |
| `scoreComponents` | 항목별 채점이 아니라 총점에 상수를 더하고 뺀 값이다 |
| `/dashboard/insights/me` | 강점·개선점·추천이 **전부 고정 문구**다. 사용자별로 계산되지 않는다 |
| `/analytics/summary` 의 `avgAnalysisTime` | 이름과 달리 분석 소요 시간이 아니라 **생성 시각(epoch)의 평균**이다 |

사용자가 자기 성과로 읽을 화면이라, 무엇을 지우고 무엇을 실제로 계산할지 정해야 한다.

---

## 17. C-4b — `/risk` 는 옮겼고, R2 는 성격이 다른 작업이었다 (2026-08-08)

### 업로드 세 곳이 같은 종류가 아니었다

| 라우트 | 파일을 보관하나 | 그래서 |
|---|---|---|
| `POST /risk` | **아니다.** 전사 후 곧바로 버린다(원본도 `finally` 에서 `unlinkSync`) | **지금 옮겼다.** R2 가 필요 없다 |
| `POST /meetings/:id/audio` | 보관 → `processAudio()` 가 나중에 읽는다 | C-5 와 함께 |
| `POST /recordings` | 보관 → 업로드 중에 **동기로** STT 를 부른다 | C-5 와 함께 |

`/risk` 는 Worker 에서 아예 디스크를 쓰지 않는다 — 받은 바이트를 그대로 OpenAI 로 보낸다.
무음 클립으로 양쪽을 태워 응답 구조와 판정이 같은 것을 확인했다(문구 차이는 LLM 비결정성이다).

### R2 를 "업로드 라우트 이관" 으로 묶은 것이 잘못이었다

파일이 R2 로 가면 **사내 Express 파이프라인이 그 파일을 못 읽는다** —
`openaiService` 가 `fs.createReadStream(filePath)` 로 로컬 경로를 연다.
업로드만 Worker 로 옮기면 저장은 R2 에, 그것을 읽어야 할 분석은 사내 디스크를 보는 상태가 된다.

그래서 **C-0(DB 이전)과 같은 모양으로 바꾼다** — 앱을 옮기기 전에 **저장소를 먼저 옮긴다.**

1. R2 버킷을 만든다
2. 기존 파일 18개를 옮긴다 (`meeting_recordings` 13건 + `meetings.audio_url` 5건)
3. **사내 Express 가 R2 를 읽고 쓰게 바꾼다** (S3 호환 자격증명). 이 시점에 사내 디스크 의존이 끊긴다
4. 확인이 끝나면 C-5 에서 파이프라인을 Worker/Workflow 로 옮긴다 — 저장소는 이미 제자리에 있다

C-0 이 그랬듯 각 단계가 되돌릴 수 있고, **Worker 를 건드리기 전에 새 저장소가 멀쩡한지 지금 화면으로 확인**할 수 있다.

### 막힌 것 — R2 토큰 권한

`wrangler r2 bucket create` 가 `Authentication error [code: 10000]` 로 거절된다.
대시보드에서 토큰에 **Account → Workers R2 Storage → Edit** 를 추가해야 한다.
버킷을 만든 뒤에는 Express 용 S3 자격증명(Access Key ID/Secret)도 필요하다.

---

## 18. C-4b 완료 — 파일이 R2 에 있다 (2026-08-08)

버킷 `sep-v2-uploads` (APAC). 사내 볼륨의 **18개를 전부 옮겼다.**

| 검증 | 결과 |
|---|---|
| 업로드 | 18/18 |
| 크기 일치 | 18/18 |
| **내용(md5) 일치** | **18/18** |
| Worker 가 읽기 | 객체 18개 · 62.7MB · 표본을 바이트까지 읽음 |

크기만으로는 부족했다 — **6,668,364 바이트짜리가 셋** 있어 뒤바뀌어도 크기 검증은 통과한다.
그래서 전부 md5 로 대조했다.

키 규칙은 `<종류>/<id><확장자>` 다.

```
/app/uploads/rec-1786115225938-344826.wav
  → recordings/28cef276-b85d-4404-aed6-73408b7af057.wav
/app/uploads/5f82a491-….mp3
  → meetings/5f82a491-….mp3
```

파일명이 아니라 **DB 의 id 로 키를 잡았다.** 원래 이름은 타임스탬프와 난수라
어느 레코드의 것인지 파일만 봐서는 알 수 없었다. 대조표는 `deploy/r2-migration-map.tsv` 에 남겼다.

### Express 에 S3 자격증명을 붙이지 않기로 했다

원래 계획은 C-0 처럼 "사내 백엔드를 새 저장소로 전환" 이었다. 그러려면 Express 에
R2 의 S3 호환 자격증명을 심어야 한다. **그런데 그 컴포넌트는 C-5-4 에서 사라진다.**
지울 코드에 자격증명을 심고 관리하는 것은 값이 없다.

그래서 지금은 이렇다.

- **DB 의 `storage_path`·`audio_url` 은 사내 경로 그대로다** — Express 는 아무것도 달라지지 않았다
- R2 에는 같은 파일의 사본이 있고 Worker 가 읽을 수 있다
- C-5-4 에서 업로드 경로가 Worker 로 넘어갈 때 **그 사이 새로 생긴 파일만 동기화**하고 DB 경로를 바꾼다

원본을 지우지 않았으므로 이 상태에서 잃을 것은 없다. 되돌릴 것도 없다 — 아직 아무것도 바꾸지 않았다.

---

## 19. Phase B 완료 — 화면이 Cloudflare 위에 있다 (2026-08-08)

**https://sep-v2-web.pages.dev** · API 는 `sep-v2-api.wooriszhome.workers.dev`.
**도메인도 터널도 쓰지 않았다.** §11 에서 정한 그대로다.

| 확인 | 결과 |
|---|---|
| 루트 | 200 |
| `/meetings` 새로고침 | 200 (`_redirects` 폴백) |
| 보안 헤더 | `nosniff` · `X-Frame-Options: DENY` |
| CORS 프리플라이트 (Pages 오리진) | 204 + `allow-origin: https://sep-v2-web.pages.dev` |
| **허용 목록 밖 오리진** | **`allow-origin` 헤더 0개** |

로그인·미팅 15건·고객 16건·대시보드·내 정보·녹음 5건·통계 전부 Pages 오리진에서 200 이다.

### CORS 는 와일드카드를 쓰지 않는다

`ALLOWED_ORIGINS` 목록에 있는 오리진에만 헤더를 준다.
사내 백엔드의 기본값이 `*` 였는데, 그건 `cors()` 에 배열로 들어가 **어떤 오리진과도 매칭되지 않는다** —
같은 오리진에서만 쓰였기 때문에 드러나지 않았을 뿐이다(§14).
인증이 쿠키가 아니라 Authorization 헤더라 `credentials` 도 필요 없다.

### 저장 경로를 R2 로 전환했다

`/app/uploads/...` → `recordings/<id><확장자>` · `meetings/<id><확장자>`.
13 + 5 = **18행 전환, 남은 사내 경로 0**. 전환된 키가 R2 에 실제로 있는지 **전수 확인**했다(18/18).

되돌릴 수 있게 `storage_path_legacy`·`audio_url_legacy` 컬럼에 옛 값을 남겼다.
컬럼 하나 값이면 충분하고, 지우고 후회하는 것보다 훨씬 싸다.

전환 직전에 사내 볼륨을 다시 세어 **새로 생긴 파일이 없음을 확인**했다(여전히 18개).
있었다면 먼저 R2 로 올린 뒤에 전환했어야 한다.

### 사내 화면은 이제 쓰지 않는다

`http://192.168.0.131:3082` 의 SPA 는 여전히 사내 Express 를 본다.
그런데 **DB 경로가 R2 키로 바뀌었으므로 그쪽 분석은 더 이상 동작하지 않는다** —
`fs.createReadStream('recordings/…')` 는 없는 파일을 연다. 읽기 화면은 여전히 뜬다.

**앞으로는 Pages 주소를 쓴다.** 사내 스택은 Phase D(WebSocket) 때문에 남겨 두는 것이지
사용자 진입점이 아니다.

---

## 20. Phase D 완료 — 실시간 게이트웨이가 Durable Object 로 (2026-08-09)

`/api/v2/stream?token=…` 이 Worker 에서 돈다. 프로토콜은 그대로 유지했다 —
클라이언트가 보내는 것(이진 오디오, `{"type":"stop"}`)과 받는 것(`ready`/`transcript`/`error`)이
사내 구현과 같아서 프런트엔드를 고치지 않았다.

### 왜 일반 Worker 로는 안 되나

`WebSocketPair` 로 업그레이드를 받는 것까지는 Worker 도 한다.
그런데 이 게이트웨이는 **업스트림(Deepgram) 연결과 8초 KeepAlive 타이머를 연결 내내 들고 있어야 한다.**
일반 Worker 는 요청 사이에 살아 있다는 보장이 없다. DO 는 그 상태를 갖는 것이 존재 이유다.

인스턴스는 사용자별(`idFromName(user.sub)`)이라 남의 스트림과 섞이지 않는다.

### 확인 (진짜 WebSocket 핸드셰이크로)

| 요청 | 응답 |
|---|---|
| 정상 토큰 | **503** — Deepgram 키가 없어서. 여기까지 왔다는 것이 곧 경로가 살아 있다는 뜻 |
| 잘못된 토큰 | 401 |
| 토큰 없음 | 401 |

curl 로는 426 이 나온다. Cloudflare 엣지가 **진짜 핸드셰이크가 아니면 `Upgrade` 헤더를 넘기지 않기** 때문이다.
raw 소켓으로 핸드셰이크를 직접 만들어야 실제 동작을 볼 수 있다.

토큰을 쿼리스트링으로 받는 것은 사내 구현과 같다 —
WebSocket 업그레이드에는 `Authorization` 헤더를 붙일 수 없다.

### 이 기능은 실제로 동작한 적이 없다

`DEEPGRAM_API_KEY` 가 **사내 `.env.production` 에도 없다.**
코드(RT-1)는 들어와 있지만 키가 없어 지금까지 한 번도 켜진 적이 없다는 뜻이다.
키를 넣으면 바로 돈다 — Worker 시크릿에 `DEEPGRAM_API_KEY` 하나만 추가하면 된다.

### 무료 플랜이 확인됐다

DO 를 만들 때 `new_classes` 가 거부되고 `new_sqlite_classes` 를 요구했다(code 10097) —
**Workers 무료 플랜**이라는 뜻이다. §10 에서 CPU 한도가 약 1.7~3.3초로 측정된 것과 맞물린다
(10ms 라는 통념과 달랐던 이유). 상태를 저장하지 않는 게이트웨이라 어느 쪽이든 동작은 같다.

---

## 21. 실시간 전사가 실제로 돈다 (2026-08-09)

키를 넣고 나서 결함 셋이 차례로 드러났다. **각각이 다음 것을 가리고 있어서** 순서대로만 보였다.

| # | 결함 | 증상 |
|---|---|---|
| 1 | Workers `fetch` 가 `wss://` 를 거부 | 연결 자체가 안 됨 |
| 2 | 101 반환 후 **DO 가 정리되며 업스트림 리스너가 죽음** | 연결은 되는데 무응답 (요청이 1.6초에 `Canceled`) |
| 3 | 이진 프레임이 Blob 으로 와서 `send()` 시 **`"[object Blob]"` 문자열화** | Deepgram 이 `SchemaError` 반환 |

3번은 2번을 고쳐 로그가 보이기 전까지는 알 수 없었다.
"연결은 됐는데 아무것도 안 온다" 는 증상만으로는 어느 층이 문제인지 가릴 수 없다.

### 모델·언어는 실측으로 골랐다

사내 코드의 기본값(`nova-3` / `multi`)은 **한국어에서 깨진다.**

| 설정 | 결과 |
|---|---|
| `nova-2` / `ko` | `이번 분기 예산은 50000000 원 정도로 잡고 있습니다.` ✅ |
| `nova-3` / `multi` | `你我们이 번 분기 에사는 오첈 만로 정도요 자고 있습니다` ✘ |

두 번 연속 재현했다. 코드 기본값을 `nova-2`/`ko` 로 바꿨고, 시크릿으로 덮을 수 있게 뒀다.
영어 위주 미팅이 생기면 그때 다시 잰다.

**측정에 함정이 하나 있었다.** 시크릿 전파에 30~60초가 걸리는데 18초만 기다리고 잰 탓에
결과가 **한 칸씩 밀려** 처음엔 `nova-3/multi` 가 좋다고 잘못 읽었다.
설정을 바꾸고 재는 실험은 전파를 기다린 뒤 **두 번 이상** 재야 한다.

### 프런트엔드에는 이 기능을 쓰는 코드가 없다

`frontend/web/src` 어디에도 `WebSocket` 참조가 없다.
게이트웨이(RT-1)는 들어왔지만 **클라이언트가 만들어진 적이 없다.**
키도 없었으므로, 이 기능은 지금까지 어느 층에서도 동작한 적이 없다.

지금 상태는 "백엔드는 준비됐고 화면이 없다" 다. 화면을 붙이려면
마이크 오디오를 linear16 16kHz 로 변환해 흘려보내는 클라이언트가 필요하다.

### Google STT v2 백업은 보류

**Google 의 스트리밍은 gRPC 전용이고 Workers 는 gRPC 를 말할 수 없다.**
같은 모양의 백업은 이 구조에서 불가능하다. REST(`:recognize`)로 버퍼를 주기적으로 보내는
형태는 가능하지만 실시간성이 낮아지고 서비스 계정·OAuth 서명이 필요하다.
사용자 판단으로 **나중에** 셋업하기로 했다.
