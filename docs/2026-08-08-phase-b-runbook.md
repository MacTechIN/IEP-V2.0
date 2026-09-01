# Phase B 실행 절차 — SPA 를 Pages 로, 백엔드를 Tunnel 로

- 작성일: 2026-08-08
- 결정: **Postgres 는 Hyperdrive 로 지금 DB 를 유지한다.** 그래서 Phase B 에서 DB 는 건드리지 않는다
- 전제: [Cloudflare 이식 준비](2026-08-08-cloudflare-readiness.md) §4 Phase B

---

## 왜 Tunnel 이 필요한가

Pages 는 SPA 를 **공개 인터넷의 HTTPS** 로 서빙한다. 백엔드는 `http://192.168.0.131:3080` —
**사설 IP 에 평문 HTTP** 다. HTTPS 페이지에서 그 주소를 부르면 브라우저가 mixed content 로 막는다.
같은 LAN 안에 있어도 막힌다. 자체서명 인증서(3443)를 쓰면 이번엔 인증서 오류가 난다.

그래서 백엔드에 **공개 HTTPS 호스트명**이 있어야 하고, 포트를 열지 않고 그걸 만드는 방법이 Tunnel 이다.

---

## 0. 선행 조건 — 도메인 (사용자 작업)

**Cloudflare 계정에 등록된 도메인이 0개다.** named tunnel 의 공개 호스트명은 zone 이 있어야 만들 수 있다.

1. 도메인을 준비한다 (Cloudflare Registrar 에서 사거나, 가진 도메인을 옮긴다)
2. Cloudflare 대시보드 → **Add a site** → 네임서버를 Cloudflare 것으로 변경
3. 상태가 **Active** 가 될 때까지 기다린다 (보통 몇 분~수 시간)

이 단계가 끝나기 전에는 아래가 전부 막힌다.

---

## 1. 터널 만들기

Zero Trust → **Networks → Tunnels** → Create a tunnel → **Cloudflared** 선택

- 이름: `sep-v2`
- 만들면 **커넥터 토큰**이 나온다. 이게 `TUNNEL_TOKEN` 이다
- **Public Hostname** 탭에서 매핑을 추가한다

| 항목 | 값 |
|---|---|
| Subdomain | `api` |
| Domain | 등록한 도메인 |
| Service | `HTTP` · `backend:3000` |

`backend:3000` 은 compose 네트워크 안의 서비스 이름이다. 호스트 포트(3080)가 아니다 —
터널 컨테이너가 같은 네트워크에 있으므로 포트를 밖으로 열 필요가 없다.

## 2. 배포 호스트에서 터널 띄우기

```bash
# 192.168.0.131 의 ~/sep-v2/deploy/.env.production 에 값을 넣는다
TUNNEL_TOKEN=<1단계에서 받은 토큰>
ALLOWED_ORIGINS=https://sep-v2-web.pages.dev

cd ~/sep-v2/deploy
docker compose -p sep-v2 -f docker-compose.prod.yml --env-file .env.production \
  --profile tunnel up -d
```

`--profile tunnel` 이 없으면 터널 컨테이너는 뜨지 않는다. 토큰 없이 뜨는 것을 막으려고 일부러 그렇게 뒀다.

확인:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.<도메인>/health   # 200 이어야 한다
```

## 3. SPA 를 Pages 에 올리기

```bash
cd ~/workspace/SEP-V2.0/frontend/web
VITE_API_URL=https://api.<도메인>/api/v2 NODE_ENV=production npm run build
npx wrangler pages deploy dist --project-name sep-v2-web
```

`VITE_API_URL` 은 **빌드 시점에 번들에 박힌다.** 나중에 바꾸려면 다시 빌드해야 한다.

`dist` 에는 `_redirects`(SPA 폴백)와 `_headers`(기본 보안 헤더)가 함께 들어간다.
`public/` 에 있으므로 빌드가 알아서 복사한다.

## 4. CORS 를 맞춘다

백엔드 CORS 는 `origin: ALLOWED_ORIGINS.split(',')`, `credentials: true` 다.
**기본값이던 `*` 는 배열 안에서 어떤 오리진과도 매칭되지 않아 전부 차단된다.**
지금까지는 nginx 뒤에서 같은 오리진이라 이 문제가 드러나지 않았다.

Pages 주소를 그대로 넣는다. 미리보기 배포까지 쓰려면 쉼표로 함께 적는다.

```
ALLOWED_ORIGINS=https://sep-v2-web.pages.dev,https://<브랜치>.sep-v2-web.pages.dev
```

인증은 `Authorization: Bearer` 헤더에 localStorage 토큰을 실어 보낸다 — **쿠키가 아니다.**
그래서 교차 사이트 쿠키(SameSite) 문제는 없다. 이건 운이 좋은 부분이다.

## 5. 확인할 것

| 항목 | 기대 |
|---|---|
| `https://api.<도메인>/health` | 200 |
| Pages URL 접속 → 로그인 | 성공, 콘솔에 CORS 오류 없음 |
| `/meetings` 새로고침 | 404 가 아니라 화면이 뜬다 (`_redirects` 확인) |
| 녹음 화면 | 마이크 접근됨 (HTTPS 라 보안 컨텍스트 충족) |
| 실시간 스트림 `/api/v2/stream` | WebSocket 연결됨 — Tunnel 은 WebSocket 을 지원한다 |
| 응답 헤더 | `X-Content-Type-Options: nosniff` 등이 붙는다 |

## 6. 이 단계에서 하지 않는 것

- **백엔드는 그대로 Express 로 사내 서버에서 돈다.** Worker 로 옮기는 것은 Phase C 다
- Postgres 도 그대로다. Hyperdrive 는 Phase C 에서 Worker 가 붙을 때 들어온다
- nginx 컨테이너(`sep-v2-web`)는 당분간 남겨 둔다. Pages 가 확인되면 그때 내린다

## 7. 되돌리는 법

Pages 배포를 지우고 SPA 는 다시 `http://192.168.0.131:3082` 를 쓴다.
백엔드는 이번 단계에서 코드가 바뀌지 않으므로 **되돌릴 것이 없다** — 터널 컨테이너만 내리면 된다.

```bash
docker compose -p sep-v2 -f docker-compose.prod.yml --profile tunnel stop cloudflared
```

## 8. 남은 주의점

- `sep-v2-web` 은 **다른 compose 파일**(`docker-compose.web.yml`)로 떠 있다.
  `--remove-orphans` 를 쓰면 같이 내려간다. 이 스택에서는 쓰지 말 것
- 배포 호스트 `~/sep-v2` 에는 git 이 없다. 배포는 rsync 단방향이다
- `deploy/deploy.sh` 는 self-hosted 절 heredoc 이 깨져 있어 실행되지 않는다 (이번 작업 이전부터)
