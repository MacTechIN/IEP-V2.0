# LEP 자원 만들기 — 순서와 이유 (2026-08-25)

SEP v2 포크 직후의 상태에서 LEP 를 **별도 서버로** 세우는 순서다.
이 문서의 이름들은 이미 설정에 박혀 있다: `lep-api`(Worker) · `lep-web`(Pages) ·
`lep-uploads`(R2). 이름을 바꾸려면 설정도 같이 바꾼다.

원칙 하나: **어느 단계에서도 sep-v2-* 를 건드릴 일이 없다.** 있다면 이 문서가 틀린 것이다.

## 0. 지금 상태 (이미 되어 있는 것)

- 폴더 `~/workspace/LEP-V2.1` — SEP v2 `df4ba6e`(v2.18.0) 포크, git 원격 없음
- `wrangler.toml`·`package.json`·CI 가 전부 LEP 이름을 가리키거나 꺼져 있음
- SEP 의 Neon 을 가리키던 Hyperdrive 바인딩 제거됨

## 1. GitHub 저장소

```bash
gh repo create MacTechIN/LEP-V2.1 --private --source ~/workspace/LEP-V2.1 --push
```

만든 뒤 `CLAUDE.md` 의 "원격 저장소: 아직 없다" 를 고친다.
워크플로는 `.github/workflows.disabled/` 에 있어서 푸시해도 아무것도 돌지 않는다 — 의도된 상태다.

## 2. Neon — LEP 전용 프로젝트

1. Neon 콘솔에서 **새 프로젝트** (SEP 프로젝트에 DB 만 추가하는 것 금지 — 요금·권한·사고 반경이 섞인다)
2. 접속 문자열을 **로컬에 저장하지 말고** 바로 GitHub 시크릿으로 (시크릿 이름은 `DATABASE_URL` 이다):
   `gh secret set DATABASE_URL --repo MacTechIN/LEP-V2.1`
3. 마이그레이션을 001 부터 차례로 (`db.yml` 은 2026-08-25 에 되살렸다):
   `gh workflow run DB --repo MacTechIN/LEP-V2.1 -f action=migrate -f file=001_….sql` … 015 까지
4. `-f action=status` 로 스키마 확인

## 3. Cloudflare — R2 · Worker

```bash
npx wrangler r2 bucket create lep-uploads
cd worker && npx wrangler deploy        # 이름이 lep-api 인지 출력에서 눈으로 확인
```

Worker 시크릿 (`npx wrangler secret put <이름>`) — SEP 와 **값을 공유하지 않는다**:

| 이름 | 주의 |
|---|---|
| `DATABASE_URL` | §2 의 LEP Neon 문자열. Hyperdrive(§5) 전까지의 연결 경로 |
| `JWT_SECRET` | **새로 만든다.** SEP 값을 재사용하면 SEP 토큰으로 LEP 에 로그인된다 |
| `JWT_EXPIRE_IN` · `JWT_REFRESH_EXPIRE_IN` | SEP 와 같은 정책이면 같은 값 |
| `OPENAI_API_KEY` | 청구를 나누려면 별도 키 발급 |
| `OPENAI_MODEL` · `OPENAI_STT_MODEL` · `OPENAI_STT_DIARIZE_MODEL` | SEP 와 동일하게 시작 |
| `PROBE_SECRET` | health.yml 되살릴 때 같이 |

첫 관리자 계정은 DB 에 직접 넣는다 — 공개 회원가입이 없는 제품이다
(`002_admin_and_roles.sql` 참고, DB 워크플로의 audit/psql 경로 이용).

## 4. Pages — 웹

```bash
cd frontend/web && npm ci && npm run deploy   # build:prod + wrangler pages deploy --project-name lep-web
```

첫 배포가 프로젝트를 만든다. 주소가 `lep-web.pages.dev` 가 아니게 나오면
`wrangler.toml` 의 `ALLOWED_ORIGINS` 를 실제 주소로 고치고 Worker 를 다시 올린다 —
CORS 는 여기 없는 오리진에 헤더를 주지 않는다.

## 5. Hyperdrive (성능 — 미루어도 된다)

직접 연결은 요청마다 365ms 를 물었다(SEP 실측). 쓰려면:
LEP Neon 문자열로 Hyperdrive 를 만들고, `wrangler.toml` 의 주석 처리된
`[[hyperdrive]]` 블록에 **LEP 용 id** 를 넣어 되살린 뒤 재배포.

## 6. CI 워크플로 되살리기

`.github/workflows.disabled/README.md` 의 표대로 **파일마다 대상을 LEP 것으로 고친 뒤**
하나씩 `workflows/` 로 옮긴다. 순서는 `db.yml`(§2 가 필요로 한다) → `deploy.yml` → `health.yml`.
백업 둘은 운영 데이터가 생길 때 한다.
`deploy.yml` 에는 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 시크릿도 필요하다.

## 7. 실시간 자막 (선택 — 없어도 제품이 돈다)

~~지금 `build:prod` 에 `VITE_STREAM_URL` 이 없어서 실시간 자막 스위치는 화면에 안 나온다.~~
**2026-08-26 올렸다** — Cloud Run `lep-stream` (`asia-northeast3`).
`build:prod` 에 `VITE_STREAM_URL=wss://lep-stream-762755478365.asia-northeast3.run.app` 이 들어갔다.
필요해지면: `stream-service/` 를 Cloud Run 에 **새 서비스**(예: `lep-stream`)로 올리고
(`ALLOWED_ORIGINS` 환경변수에 LEP 오리진), `build:prod` 에
`VITE_STREAM_URL=wss://<새 서비스 주소>` 를 되살린다.

## 8. 마지막 확인

- `curl -s https://lep-api.<계정>.workers.dev/health` — LEP 가 살아 있다
- `curl -s https://sep-v2-web.pages.dev/ | grep -o 'index-[^"]*\.js'` — **SEP 번들이 그대로다**
  (이 작업 전후로 같아야 한다. 다르면 어딘가에서 SEP 를 건드린 것이다)
