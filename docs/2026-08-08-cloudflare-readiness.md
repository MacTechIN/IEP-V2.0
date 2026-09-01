# v2 Cloudflare 이식 준비

- 작성일: 2026-08-08
- 목적: 지금 Docker Compose(사내 `192.168.0.131`)로 도는 v2 를 Cloudflare 에 올리려면 **무엇이 걸리고 무엇을 바꿔야 하는지** 확정한다
- 전제: v1(`MacTechIN/sep`)과 v2(`MacTechIN/SEP-V2.0`)는 **별개 저장소로 완전히 분리한다.** 코드도 배포도 섞지 않는다

---

## 1. 지금 무엇이 도는가 (실측)

| 컨테이너 | 역할 | 포트 |
|---|---|---|
| `sep-v2-web` | nginx — SPA(`frontend/web/dist`) 서빙 + `/api` 프록시 + 자체서명 TLS | 3082→80, 3443→443 |
| `sep-v2-backend` | Express/TypeScript API + WebSocket | 3080→3000 |
| `sep-v2-postgres` | Postgres | 내부 5432 |
| `sep-v2-redis` | Redis | 내부 6379 |

백엔드는 TypeScript 31개 파일 3,785줄이다. 외부 의존은 express(17), fs(6), uuid(5), path(4),
multer(3), ws(1), pg(1), jsonwebtoken, bcryptjs, winston, axios, cors, form-data.

**`redis` 는 컨테이너만 떠 있고 코드에서 한 번도 import 되지 않는다.** 이식 대상이 아니라 삭제 대상이다.

---

## 2. 걸림돌과 대응 — 어려운 것부터

### 2.1 (최대 난관) WebSocket 스트림 게이트웨이

`services/streamGateway.ts` 가 `new WebSocketServer({ noServer: true })` 로 HTTP 서버의
`upgrade` 이벤트를 가로채, 브라우저 오디오(linear16 16kHz)를 받아 **Deepgram 실시간 전사**로 중계한다.
가장 최근에 들어온 기능(RT-1)이고, 가장 옮기기 어렵다.

Workers 에는 **연결을 듣는 소켓이 없다.** `ws` 패키지가 통째로 못 돈다.
대응은 `WebSocketPair` + **Durable Object** 다 — 장시간 세션과 KeepAlive 타이머는 상태를 들고 있어야
하는데, 일반 Worker 는 요청 사이에 상태를 유지하지 못한다.

- 업스트림(Deepgram)으로 나가는 WebSocket 은 Workers 에서 `fetch(..., { headers: { Upgrade: 'websocket' } })` 로 연다
- 무음 KeepAlive 는 DO 의 `alarm()` 또는 세션 내 타이머로 옮긴다
- **이건 재설계이지 포팅이 아니다.** 마지막에 손대는 것이 맞다

### 2.2 파일 업로드가 로컬 디스크에 쓴다

`routes/recordings.ts`·`meetings.ts`·`risk.ts` 세 곳이 `multer.diskStorage` 를 쓴다.
Workers 에 **파일 시스템이 없다.** 업로드는 **R2** 로 가야 하고, 저장 경로를 읽는 쪽도 같이 바뀐다.

nginx 가 `client_max_body_size 100M` 로 받고 있는데, Workers 요청 본문 한도와
분할 업로드 여부를 함께 정해야 한다.

### 2.3 Express 를 걷어내야 한다

라우트 17개 파일이 `express` 에 직접 얹혀 있고 `node:http` 로 서버를 띄운다.
Workers 는 `fetch` 핸들러 하나가 진입점이라 라우터를 갈아야 한다 — **Hono** 가 가장 가깝다
(미들웨어·라우팅 형태가 Express 와 닮아 변환이 기계적이다).

`cors`·`jsonwebtoken`·`bcryptjs` 는 그대로 쓸 수 있다.
다만 bcrypt 는 순수 JS 라 CPU 를 먹는다 — 라운드 수와 Workers CPU 한도를 같이 봐야 한다.
`winston` 은 걷어내고 `console` + Logpush 로 간다.

### 2.4 Postgres 연결

`utils/database.ts` 가 `pg.Pool` 로 TCP 연결을 연다. Workers 에서 Postgres 를 쓰려면
**Hyperdrive** 를 거친다. SQL 과 스키마는 그대로 두고 연결 문자열만 바꾸면 되므로,
**이 부분은 생각보다 싸다.**

### 2.5 마이그레이션이 부팅 중에 디스크를 읽는다

`initializeDatabase()` 가 기동 시 `runMigrations()` 를 부르고, 마이그레이션 SQL 을
`fs` + `__dirname` 으로 읽는다. Workers 에는 둘 다 없다.
`database/*.sql` 5개를 **배포와 분리된 별도 단계**로 빼야 한다(CI 또는 psql CLI).
서버 기동 시 스키마를 바꾸는 구조 자체가 서버리스와 맞지 않는다.

### 2.6 nginx 가 하던 일

SPA 서빙 → **Pages**, `/api/*` 프록시 → **Worker 라우트**, TLS → Cloudflare 가 자동.
자체서명 인증서와 3443 포트는 사라진다.

---

## 3. 정리

| 현재 | Cloudflare | 난이도 |
|---|---|---|
| `ws` WebSocketServer (Deepgram 중계) | Durable Object + `WebSocketPair` | **높음 — 재설계** |
| `multer.diskStorage` × 3 | R2 | 중간 |
| Express × 17 + `node:http` | Hono | 중간(기계적) |
| `pg.Pool` | Hyperdrive | 낮음 |
| 부팅 시 `fs` 마이그레이션 | 별도 CLI 단계 | 낮음 |
| `winston` | console + Logpush | 낮음 |
| nginx (SPA·프록시·TLS) | Pages + Worker 라우트 | 낮음 |
| `redis` 컨테이너 | **삭제** (코드 미사용) | — |

---

## 4. 권장 순서

**Phase A — 정리 (위험 없음)**
`redis` 컨테이너 제거, 마이그레이션을 기동 경로에서 분리.
지금 구조에서도 그대로 이득이고, 이식 여부와 무관하게 옳다.

**Phase B — 프런트엔드만 Pages 로**
`frontend/web` 을 Pages 에 올리고 `/api/*` 는 당분간 현재 백엔드로 보낸다.
백엔드를 건드리지 않으므로 **되돌리기 쉽고**, TLS·CDN·자체서명 인증서 문제가 즉시 사라진다.

**Phase C — HTTP API 를 Worker 로**
Hono + Hyperdrive + R2. WebSocket 은 아직 건드리지 않고 기존 백엔드에 남겨둔다.
이 단계까지 오면 Postgres 만 외부에 남는다.

**Phase D — 실시간 스트림을 Durable Object 로**
가장 어렵고 가장 최근 기능이다. 앞 단계가 안정된 뒤에 한다.

**Phase B 와 C 사이에서 멈춰도 제품은 성립한다.** 그게 이 순서를 고른 이유다.

---

## 5. 먼저 정해야 할 것

**Postgres 를 어디에 둘 것인가.** 이 결정이 Phase C 이후 전부를 바꾼다.

| 선택 | 뜻 |
|---|---|
| Hyperdrive + 기존 Postgres 유지 | SQL·스키마·마이그레이션 5개를 그대로 쓴다. 다만 **DB 를 어딘가에서 계속 운영**해야 한다(사내 서버 또는 관리형) |
| 관리형 Postgres(Neon 등)로 이전 | 사내 서버 의존이 사라진다. 데이터 이전이 한 번 필요하다 |
| v1 처럼 Supabase 로 이전 | 인증·RLS·Storage 를 얻는 대신, v2 의 자체 JWT 인증을 걷어내는 큰 변경이 따른다. **분리 원칙과도 어긋난다** |

세 번째는 권하지 않는다 — v1 과 v2 를 붙이는 방향이고, 지금 정한 분리 원칙과 정면으로 어긋난다.

## 6. 아직 확인하지 않은 것

- `frontend/web` 빌드가 배포 호스트에 `dist` 만 있다. 소스는 이 저장소에 있으므로 문제는 없지만,
  **배포 호스트에는 버전 관리가 없다**(`~/sep-v2` 에 `.git` 없음). 배포는 rsync 한 방향뿐이다
- Deepgram 키·OpenAI 키가 지금 어디에 주입되는지 (compose 환경변수로 추정)
- 업로드 파일의 현재 총량 — R2 이전 비용과 시간에 영향
- Workers 유료 요금제 여부 (CPU 한도·Durable Objects 사용 가능 여부가 여기 걸린다)
