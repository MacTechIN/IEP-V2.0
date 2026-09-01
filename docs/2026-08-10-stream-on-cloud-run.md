# 실시간 스트림을 Cloud Run 으로

- 작성일: 2026-08-10
- 이유: **관리 복잡도.** Durable Object 를 없앤다
- 상태: **배포·검증 완료.** Worker 의 Durable Object 도 제거했다 (2026-08-10)

---

## 왜 이것만 옮기는가

[GCP 통합 조사](2026-08-10-gcp-consolidation.md) 에서 "전부 옮기는 것은 지금 권하지 않는다" 로 정리했다.
그중 **스트림만은 옮기는 것이 확실히 낫다.**

Workers 에는 연결을 듣는 소켓이 없어 `ws` 가 통째로 못 돈다. 그래서 Durable Object 로 우회했고,
그 우회 때문에 하루에 세 가지를 연달아 밟았다.

| 결함 | 원인 |
|---|---|
| 연결 자체가 안 됨 | Workers 의 `fetch` 가 `wss://` 스킴을 거부 |
| 연결은 되는데 무응답 | 101 반환 후 DO 가 정리되며 업스트림 리스너가 죽음 |
| Deepgram 이 `SchemaError` | 이진 프레임이 Blob 으로 와서 `send()` 시 `"[object Blob]"` |

**셋 다 Cloud Run 에서는 존재하지 않는다.** 사내 원본 코드가 거의 그대로 돈다.

### 덤으로 얻는 것 둘

**Google 백업이 진짜 스트리밍이 된다.** Workers 는 gRPC 를 못 해서 10초 버퍼 REST 로 우회해야 했다.
Cloud Run 에서는 `StreamingRecognize` 를 그대로 쓴다 — 지연이 버퍼 길이가 아니라 수백 ms 다.

**서비스 계정 키 파일이 필요 없다.** Cloud Run 의 기본 자격증명(ADC)이 붙는다.
지금 만들고 계신 JSON 키는 **이 경로에서는 쓰지 않는다** — 서비스 계정에 `roles/speech.client` 만 붙이면 된다.
키를 만들고 보관하고 교체하는 일 자체가 없어진다. 관리 복잡도를 줄이는 것이 목적이었으니 방향이 맞다.

---

## 배포

`gcloud` 가 없다. 설치 후 아래 순서다.

```bash
# 1) gcloud 설치·인증
curl https://sdk.cloud.google.com | bash && exec -l $SHELL
gcloud auth login
gcloud config set project <프로젝트ID>

# 2) 필요한 API
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com speech.googleapis.com

# 3) 서비스 계정 (Google STT 백업용 — 키 파일 없이 이 계정으로 붙는다)
gcloud iam service-accounts create sep-v2-stream --display-name="SEP v2 Stream"
gcloud projects add-iam-policy-binding <프로젝트ID> \
  --member="serviceAccount:sep-v2-stream@<프로젝트ID>.iam.gserviceaccount.com" \
  --role="roles/speech.client"

# 4) 배포 (소스에서 바로 — 이미지를 직접 밀 필요가 없다)
cd ~/workspace/SEP-V2.0/stream-service
gcloud run deploy sep-v2-stream \
  --source . \
  --region asia-northeast3 \
  --service-account sep-v2-stream@<프로젝트ID>.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --timeout 3600 \
  --min-instances 0 \
  --set-env-vars "ALLOWED_ORIGINS=https://sep-v2-web.pages.dev,GOOGLE_STT_LANGUAGE=ko-KR,DEEPGRAM_MODEL=nova-2,DEEPGRAM_LANGUAGE=ko" \
  --set-secrets "JWT_SECRET=sep-v2-jwt:latest,DEEPGRAM_API_KEY=sep-v2-deepgram:latest"
```

`--allow-unauthenticated` 는 **Cloud Run 의 IAM 인증을 끄는 것**이지 우리 인증을 끄는 게 아니다.
서비스가 직접 JWT 를 검증한다 — 안 그러면 브라우저가 붙을 수 없다(IAM 토큰을 붙일 방법이 없다).

`--timeout 3600` 이 WebSocket 수명이다. 1시간을 넘는 미팅이면 늘린다(최대 60분이 기본, 상향 가능).

### 시크릿 두 개

```bash
printf '%s' "<JWT_SECRET 값>"      | gcloud secrets create sep-v2-jwt --data-file=-
printf '%s' "<DEEPGRAM_API_KEY>"   | gcloud secrets create sep-v2-deepgram --data-file=-
gcloud secrets add-iam-policy-binding sep-v2-jwt --member="serviceAccount:sep-v2-stream@<프로젝트ID>.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding sep-v2-deepgram --member="serviceAccount:sep-v2-stream@<프로젝트ID>.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

**`JWT_SECRET` 은 Worker 와 같은 값이어야 한다.** 로그인은 Worker 가, 스트림은 Cloud Run 이 처리하므로
한쪽이 발급한 토큰을 다른 쪽이 받는다. 값이 어긋나면 "로그인은 되는데 스트림만 401" 이 된다.

---

## 로컬 검증 결과

컨테이너를 띄워 확인했다.

| 항목 | 결과 |
|---|---|
| `/health` | `{"ok":true}` |
| **Worker 발급 토큰 → 업그레이드** | **101 Switching Protocols** |
| 잘못된 토큰 | 401 |
| 토큰 없음 | 401 |
| 다른 경로 | 응답 없이 소켓 종료 |

Deepgram 키 없이 띄우면 백업으로 시작한다는 로그도 확인했다.

---

## 배포 뒤에 할 일

~~2. Worker 에서 DO 제거~~ ✅ 완료 — `StreamGateway`, `[[durable_objects.bindings]]`,
`/api/v2/stream` 라우트, `services/googleStt.ts` 를 지웠다.
**클래스를 지울 때는 삭제 마이그레이션(`deleted_classes`)이 있어야 한다** — 바인딩만 빼면 배포가 거부된다.

~~3. `DEEPGRAM_*` 시크릿 정리~~ ✅ 완료 — 키는 GCP Secret Manager(`sep-v2-deepgram`)에 남아 있고
Cloud Run 이 거기서 읽는다. **지우기 전에** 그 사실을 확인했다.
`GOOGLE_*` 은 애초에 넣은 적이 없다 — Cloud Run 은 ADC 로 붙어서 키 파일이 필요 없다.

1. **화면 연결** — 프런트엔드에는 아직 이 WebSocket 을 쓰는 코드가 **없다.** ← 남은 것은 이것뿐이다.
   위험 레이더는 `/risk`(HTTP)를 쓴다. 실시간 자막을 화면에 붙일 때 `VITE_STREAM_URL` 로 이 주소를 준다

---

## 비용

Cloud Run 은 요청이 없을 때 인스턴스를 0으로 내린다(`--min-instances 0`).
**스트림을 안 쓰면 $0 이다.** 쓰는 동안만 vCPU·메모리 시간이 과금되고, 무료 한도가 넉넉하다.

다만 WebSocket 은 연결이 열려 있는 내내 인스턴스가 살아 있어야 하므로,
**미팅 시간에 비례**한다. Durable Object 도 같은 성격이었다.
