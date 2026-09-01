# 왜 꺼져 있나

이 워크플로들은 SEP v2 에서 가져온 것이다. **아직 되살리지 않는다** —
가리키는 LEP 자원(`lep-web` Pages, `lep-api` Worker, `lep-uploads` 버킷)이 아직 없고,
시크릿도 안 넣었다. 지금 `workflows/` 로 옮기면 매 푸시마다 실패한다.

**대상 이름은 2026-08-25 에 이미 LEP 것으로 바꿔 두었다.**
문서로만 막아 두면 `git mv` 한 번에 LEP 코드가 **SEP 운영으로 나간다** — 그건
문서가 아니라 코드로 막아야 하는 종류다. 이제 실수로 되살려도 최악이
"없는 LEP 자원에 대고 실패" 이지 "SEP 를 덮어씀" 이 아니다.

되살리는 순서는 `docs/2026-08-25-lep-fork-provisioning.md`. 파일마다 아래를 확인하고 옮긴다.

| 파일 | 되살리기 전에 바꿀 것 |
|---|---|
| `deploy.yml` | 이름은 이미 lep-*. **`CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 시크릿**이 필요하다 |
| ~~`db.yml`~~ | 2026-08-25 되살림 — `DATABASE_URL` 시크릿(LEP Neon)으로 돈다 |
| ~~`health.yml`~~ | **2026-08-26 되살림.** 켜기 직전에 감시 대상이 `sep-v2-*` 인 것을 잡았다 — 그대로 켰으면 **LEP 이 죽어도 초록불**이었다 |
| ~~`restore-drill.yml`~~ | **2026-08-26 되살림.** `DATABASE_URL` 만 있으면 된다. 프로덕션은 읽기만 한다 |
| ~~`r2-backup.yml`~~ | **2026-08-26 되살림.** R2 S3 키(읽기 전용·lep-uploads)로 돈다 |
| ~~(옛 줄)~~ | 버킷 이름은 lep-*. **R2 S3 키**(`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`)가 필요하다 — SEP 에서 2026-08-25 에 이 방식으로 바꿔 좁은 토큰으로 돌게 했다 |
