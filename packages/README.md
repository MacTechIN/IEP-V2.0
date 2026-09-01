# packages/

## sep-kit 은 여기 없다

`~/workspace/sep-kit` 으로 **옮겼다** (2026-08-22). 복사가 아니라 이동이다.

두 벌을 두면 이 작업의 목적 자체가 무너진다 — 애초에 같은 엔진이 세 벌이어서
2026-08-20 에 한국어가 영어로 전사되던 것을 고칠 때 **여섯 곳에 같은 수정을 각각**
넣어야 했고, 그걸 끊으려고 떼어낸 것이다. v2 안에 한 벌을 더 두면
`packages/sep-kit` 과 `~/workspace/sep-kit` 이 갈라진다.

## 무엇이 들어 있나

전사 · 화자 분리 · 미팅 분석 · 실시간 위험 판정 · 인증(JWT·bcrypt·미디어 티켓) ·
구조화 로그. 919줄, 의존 둘(jose · bcryptjs), 플랫폼 의존 없음.

- `~/workspace/sep-kit/CATALOG.md` — 무엇이 있나
- `~/workspace/sep-kit/USAGE.md` — 어떻게 쓰나
- `~/workspace/sep-kit/INTERNALS.md` — 왜 그렇게 도나
- `~/workspace/sep-kit/PORTING.md` — 원본과 대조하는 법

## v2 는 아직 이 꾸러미를 쓰지 않는다

`worker/src/services/openai.ts` 등이 그대로 남아 있다. 갈아타는 절차는
`~/workspace/sep-kit/INTEGRATION.md` 의 "원본을 함께 쓰는 동안" 절에 있다.

끝났는지 재는 법: `npm run test:transcript -w worker` 가 전사 호출 지점 수를 센다.
지금 **6** 이고, 이관이 끝나면 **3** 이어야 한다. 안 줄면 옮긴 게 아니라 한 벌 더 만든 것이다.
