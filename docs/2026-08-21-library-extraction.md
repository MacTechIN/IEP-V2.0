# 기능별 목록과 라이브러리화 — 어디를 자를 수 있나

- 작성일: 2026-08-21
- 대상: `worker/src` 3,912줄 (화면 제외). `backend/src` 4,046줄은 같은 것의 옛 구현이다
- 결론: **1,872줄(48%)이 플랫폼과 무관하다.** 지금 그대로 떼어낼 수 있다

---

## 왜 지금인가 — 같은 엔진이 이미 세 벌이다

```
SEP-V2.0/worker/src/services/openai.ts           656줄   md5 ad8c77e2
SEP-V3-MAIN/worker/src/services/openai.ts        656줄   md5 ad8c77e2   ← 바이트까지 같다
SEP-V2.0/backend/src/services/openaiService.ts   721줄   md5 5f49e9fd   ← 이미 갈라졌다
```

v2 와 V3 는 **복사본**이고, 사내 backend 는 **갈라진 사본**이다.
같은 이름의 함수가 양쪽에 따로 있다 — `transcribeAudio` · `mapSpeakerRoles` · `generateReport` ·
`analyzeMeeting` · `generateScorecard` · `transcribeQuick` · `assessRisk` · `collapseRepeats` ·
`parseDiarized`.

**이건 가정이 아니라 이미 비용을 치른 일이다.** 2026-08-20 에 한국어 회의가 영어로 전사되던 것을
고칠 때, 언어 고정을 **여섯 곳**에 각각 넣어야 했다(worker 셋 · backend 셋).
그때 쓴 시험이 파일이 아니라 **호출 지점 수를 세는** 이유가 그것이다 —
한 파일에 전사가 둘이면 하나만 고쳐도 통과해 버린다.

`collapseRepeats` 도 마찬가지였다. `backend` 가 `parseDiarized` 를 자기 것으로 따로 갖고 있어
양쪽에 같은 방어를 각각 심었다. **한쪽만 고치면 그 경로로 들어온 녹취만 조용히 오염된다.**

라이브러리화의 목적은 정리가 아니라 **이 반복을 끊는 것**이다.

---

## 실측 결합도

각 모듈이 무엇에 묶여 있는지 셌다. `CF` 는 Cloudflare 고유(R2·Workflow·Hyperdrive),
`DB` 는 Postgres, `AI` 는 OpenAI 호출, `Hono` 는 웹 프레임워크다.

| 모듈 | 줄 | CF | DB | AI | Hono | 판정 |
|---|---:|---:|---:|---:|---:|---|
| `services/openai.ts` | 656 | **0** | **0** | 14 | **0** | 그대로 떼어낼 수 있다 |
| `services/risk.ts` | 90 | **0** | **0** | 6 | **0** | 그대로 떼어낼 수 있다 |
| `lib/auth.ts` | 112 | **0** | **0** | **0** | **0** | 그대로 떼어낼 수 있다 |
| `lib/log.ts` | 61 | **0** | **0** | **0** | **0** | 그대로 떼어낼 수 있다 |
| `services/meetings.ts` | 322 | **0** | 22 | 0 | **0** | `pg.Client` 만 요구 |
| `services/dashboard.ts` | 217 | **0** | 5 | 0 | **0** | `pg.Client` 만 요구 |
| `services/users.ts` | 136 | **0** | 13 | 0 | **0** | `pg.Client` 만 요구 |
| `services/actions.ts` | 99 | **0** | 8 | 0 | **0** | `pg.Client` 만 요구 |
| `services/customers.ts` | 99 | **0** | 8 | 0 | **0** | `pg.Client` 만 요구 |
| `services/renote.ts` | 80 | **0** | 5 | 0 | **0** | `pg.Client` 만 요구 |
| `services/recordings.ts` | 352 | **10** | 18 | 0 | 0 | R2·Workflow 에 묶여 있다 |
| `lib/voice.ts` | 40 | 1 | 0 | 0 | 0 | R2 에서 읽는다 |
| `lib/db.ts` | 37 | 3 | 3 | 0 | 0 | Hyperdrive 어댑터 |
| `lib/env.ts` | 43 | 4 | 0 | 1 | 0 | 바인딩 타입 선언 |
| `middleware.ts` | 59 | 0 | 0 | 0 | 1 | Hono 전용 |
| `routes/*.ts` | 976 | — | — | — | — | Hono 전용 |
| `workflows/*.ts` | 395 | — | — | — | — | Cloudflare Workflows 전용 |
| `index.ts` | 138 | — | — | — | — | 진입점 |

**놀라운 것은 도메인 모듈 여섯이 `pg.Client` 타입과 `queryOne` 헬퍼 하나만 쓴다는 점이다.**

```ts
import type pg from 'pg'
import { queryOne } from '../lib/db'
```

`withDb` 도, Hyperdrive 도 안 쓴다. `queryOne` 은 `lib/db.ts` 안의 10줄짜리 헬퍼다.
**그 함수 하나만 같이 옮기면 여섯 모듈이 통째로 이동한다.**

---

## 제안하는 경계 — 패키지 셋

### `@sep/ai` — 746줄 · 결합 0

`services/openai.ts` · `services/risk.ts`

전사 · 화자 분리 · 반복 접기 · 요약 · 점수 · 코칭 · 미팅노트 · 위험 판정.
**이 제품의 값어치가 대부분 여기 있고, 플랫폼에 하나도 묶여 있지 않다.**

떼어낼 때 고칠 것은 하나뿐이다. 지금은 Cloudflare 바인딩 타입이 든 `Env` 를 통째로 받는데,
실제로 쓰는 것은 다섯 개다.

```ts
// 지금            →  바꿀 것
transcribeAudio(env, …)     transcribeAudio(cfg: AiConfig, …)

interface AiConfig {
  apiKey: string
  model?: string              // OPENAI_MODEL
  sttModel?: string           // OPENAI_STT_MODEL
  sttDiarizeModel?: string    // OPENAI_STT_DIARIZE_MODEL
  language?: string           // OPENAI_STT_LANGUAGE
}
```

`fetch` 만 있으면 Workers · Node · Deno 어디서든 돈다. **런타임 의존성이 없다.**

### `@sep/core` — 173줄 · 결합 0

`lib/auth.ts` · `lib/log.ts`

JWT 서명·검증(HS256) · bcrypt · 재생 티켓(범위·수명 제한) · 비밀번호 정책 · 요청 id · 소요 측정.
`jose` 와 `bcryptjs` 외에 아무것도 안 쓴다. 그대로 옮기면 된다.

### `@sep/domain` — 953줄 · Postgres 만

`services/meetings.ts` · `dashboard.ts` · `users.ts` · `actions.ts` · `customers.ts` · `renote.ts`

미팅 · 고객 · 액션 · 사용자 · 대시보드 집계 · 미팅노트 재생성.
`pg.Client` 를 인자로 받으므로 **Neon 이든 사내 Postgres 든 상관없다.**

옮길 때 `queryOne` 을 같이 가져가고, `lib/db.ts` 의 나머지(`connectionString` · `withDb`)는
남긴다 — 그쪽이 Hyperdrive 어댑터다.

---

## 옮기지 않는 것

| 무엇 | 왜 |
|---|---|
| `services/recordings.ts` | R2 `put/get/delete` 와 Workflow `create` 가 몸통에 박혀 있다. 저장소 인터페이스를 먼저 뽑아야 한다 |
| `lib/voice.ts` | R2 에서 클립을 읽어 data URL 로 만든다. `@sep/ai` 가 쓰지만 읽기는 플랫폼 일이다 — **경계는 "바이트를 넘겨받는다" 로 그어야 한다** |
| `lib/db.ts` · `lib/env.ts` | Hyperdrive·바인딩 어댑터. 어댑터는 남는 게 맞다 |
| `middleware.ts` · `routes/*` | Hono 전용. 라우팅은 애플리케이션의 몫이다 |
| `workflows/*` | Cloudflare Workflows 전용. 단계 분할과 재시도 정책은 그 런타임의 것이다 |

**`recordings.ts` 가 가장 엉켜 있다** — CF 10 · DB 18. 이걸 억지로 옮기려 하면 저장소 추상화를
만들게 되고, 그러면 이 작업이 리팩터링이 아니라 재설계가 된다. 지금은 두지 않는다.

---

## 순서

1. **`@sep/ai` 부터.** 값어치가 가장 크고 결합이 0이며, `Env` → `AiConfig` 한 번의 치환이
   전부다. 이게 끝나면 **세 벌이 한 벌이 된다** — 그게 이 작업의 목적이다
2. **`@sep/core`.** 그대로 이동. 위험이 거의 없다
3. **`@sep/domain`.** `queryOne` 을 같이 가져간다
4. `recordings.ts` 는 저장소 인터페이스를 정한 뒤에. **지금 정하지 않는다**

`backend/src` 는 4번 뒤에 지운다 — 그 전에 지우면 사내 경로가 끊긴다.
(사내 `sep-v2-backend` 컨테이너가 아직 떠 있다. 프로덕션 경로는 아니다.)

---

## 어떻게 확인하나

옮긴 것이 실제로 하나가 됐는지 재는 방법이 이미 있다.
`worker/tools/transcript-quality.test.mjs` 가 **전사 호출 지점 수와 언어 고정 수를 센다.**

```
언어를 안 거는 전사 경로가 없다 — 전사 호출 6곳 · 언어 고정 6곳
```

라이브러리화가 끝나면 이 숫자가 **6에서 3으로** 줄어야 한다(worker 셋이 라이브러리 셋이 되고
backend 셋이 사라진다). **숫자가 안 줄면 옮긴 게 아니라 한 벌 더 만든 것이다.**

그리고 V3 저장소의 사본은 V3 세션이 맡는다 — 저장소 경계는
`v2 는 v2 세션 · V3 는 V3 세션` 으로 합의돼 있다.

---

## 한 줄 요약

**48%는 지금 떼어낼 수 있고, 그중 절반(`@sep/ai` 746줄)이 이 제품의 핵심이며 결합이 0이다.**
나머지는 어댑터라 남는 것이 맞다. 시작점은 `services/openai.ts` 하나다.
