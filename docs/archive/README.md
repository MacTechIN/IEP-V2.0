# 접어 둔 문서

**지운 것이 아니다.** 그때의 판단 근거로서 값어치가 있어 남긴다.

## 왜 여기로 왔나

`docs/ARCHITECTURE.md` 와 `CLAUDE.md` 가 생기면서, 여기 있는 문서들이 말하는 구성·절차가
**지금과 달라졌다.** 특히 이 문서들은 **사내 Express 백엔드**를 전제로 쓰였는데,
2026-08-11 에 Cloudflare Workers 로 이관이 끝났고 사내 서버는 내리기로 했다.

**지금 사실을 알고 싶으면** `CLAUDE.md` 와 `docs/ARCHITECTURE.md` 를 본다.

## 2026-08/

| 문서 | 무엇이었나 | 지금은 |
|---|---|---|
| `PRODUCTION_READY.md` | 상용 준비 상태 | `docs/develop_plan.html` |
| `PRODUCTION_CHECKLIST.md` | 배포 전 점검 | `CLAUDE.md` 의 배포 절차 |
| `PRODUCTION_DEPLOYMENT.md` | 배포 절차 | 같음 |
| `DEPLOYMENT_GUIDE.md` | 배포 가이드 | 같음 |
| `DEPLOYMENT_STATUS.md` | 그 시점 배포 상태 | `CHANGELOG.md` |

다섯이 **서로만 가리키고 있었다.** 어느 것을 봐야 하는지 알 수 없어 함께 접었다 —
`CLAUDE.md` 의 배포 절차 한 곳으로 모았다.

## 접지 않은 것

- `docs/` 의 설계 문서(`MVP_V2.0_PLAN`·`API_SPEC`·`DATABASE_SCHEMA` 등)
  — 낡았지만 그 시점의 설계 의도가 담겨 있다. `ARCHITECTURE.md` 가 지금 사실을 말한다
- 날짜가 이름에 있는 기록물 — 이미 오해가 없다
