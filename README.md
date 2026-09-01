# IEP V2.0 — Investigation Enablement Platform

**경찰 수사관을 위한 조사 분석 플랫폼.** 피의자 신문·참고인·피해자 조사를 녹음하면,
전사·화자 구분을 거쳐 **확인해 볼 점**을 원문 인용과 함께 짚고, 조서·수사보고 초안까지 만든다.

> **대전제(§0): 판정하지 않고 근거를 짚는다.** 거짓말·심리·진위를 판정하지 않는다.
> 사람이 아니라 **문장을 가리킨다.** 나온 것은 전부 **참고 자료**이고, 판단은 수사관이 한다.

SEP → LEP → **IEP** 로 이어진 세 번째 독립 제품이다. 코드 계보는 이어받았지만
저장소·서버·DB·버킷·버전이 전부 별개다 — SEP·LEP 와 어떤 자원도 공유하지 않는다.

## 본연의 기능

| 기능 | 무엇을 하나 |
|---|---|
| **조사 녹음·전사** | 10분 조각+겹침 녹음 / 파일 업로드(≤100MB) → Whisper 전사 |
| **화자 구분** | 수사관·대상자 구분. 근거가 부족하면 **미상**으로 둔다 (틀린 호칭보다 빈 호칭) |
| **진술 분석** ★ | **모순**(인용 2개)·**미확인 주장**(+물어볼 질문)·**태도 변화**·**미응답**을 원문 인용과 함께. 피해자 조사는 모순 짚기 제외(2차 피해 방지) |
| **인용 대조** | 모델이 든 인용이 전사에 실제로 있는지 **두 겹으로 대조**(서비스 + DB 제약) — 없으면 버린다 |
| **실시간 자막·코칭** | 녹음 중 자막(Cloud Run 스트림, Deepgram+Google)과 진행 코칭(약 25초) |
| **조서·수사보고** | **진술조서·피의자신문조서·수사보고**를 모델 없이 조립(지어내지 않음). 전부 초안 |
| **수사사건 관리** | 여러 조사를 사건으로 묶기 · 소속 기관(경찰/해양경찰)별 분야 |

★ = 핵심 가치. **점수·등급은 어디에도 없다** (§0).

## 구성 (배포 대상)

| 층 | 대상 |
|---|---|
| 웹 | Cloudflare Pages — `iep-web.pages.dev` |
| API | Cloudflare Worker(Hono) — `iep-api.wooriszhome.workers.dev` |
| 실시간 자막 | Cloud Run — `iep-stream` (asia-northeast3, Deepgram+Google STT) |
| 저장 | Neon Postgres(스키마 `v2`) · Cloudflare R2(`iep-uploads`) |
| 배포 | GitHub Actions `deploy.yml` (worker+web+번들확인+태그) · 마이그레이션 `db-migrate.js` |

- **현재 버전** — `0.4.1`
- **마이그레이션** — `034` 까지 적용 (`schema_migrations` 원장으로 추적)
- **저장소** — `github.com/MacTechIN/IEP-V2.0`

## 무엇부터 읽나

| 알고 싶은 것 | 문서 |
|---|---|
| 작업 규칙·배포 절차 (매 세션) | `CLAUDE.md` |
| 무엇이 고쳐졌나 (버전 이력) | `CHANGELOG.md` |
| 지금 구조 | `docs/ARCHITECTURE.md` |
| 검사·환경·시나리오 | `docs/QA_TEST_PLAN.md` |
| 사용자가 보는 동작 | `USER_MANUAL_RECORDING.md` · `frontend/web/public/guide.html` |
| 전체 프로세스 한눈에 | `docs/2026-09-01-iep-process.html` |

`docs/` 의 날짜 붙은 문서는 그날의 기록이다 — 근거로 읽되 현재라고 믿지 않는다.

## 개발자

**Sam LEE** · wooriszhome@gmail.com
