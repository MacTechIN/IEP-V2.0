# Google STT 백업 — 검증 완료

- 작성일: 2026-08-10
- 상태: **동작 확인.** Cloud Run 에서 진짜 스트리밍(gRPC)으로 돈다
- 위치: `stream-service/src/index.ts` 의 `relayGoogle()`

주경로는 Deepgram 이다. Deepgram 연결이 **열리기 전에** 실패하면 이쪽으로 넘어간다.
열린 뒤에 끊기면 넘기지 않는다 — 중간에 엔진을 바꾸면 화자 번호 체계가 갈아엎어져 녹취가 더 혼란스러워진다.

---

## 실측 (실제 한국어 영업 미팅 2분 19초, 실시간 속도)

| | 주경로 Deepgram | 백업 Google |
|---|---|---|
| 첫 전사 | 1.4초 | **1.3초** |
| 최종 전사 | 44건 | 3건 (덩어리가 크다) |
| 글자 수 | 737 | **697** |
| 화자 구분 | 2명 | **없음** |

**지연은 같은 수준이다.** Workers 시절의 10초 버퍼 REST 우회가 사라졌기 때문이다.
정확도는 조금 낮다 — "격리 저장"을 "경리 저장"으로, "10명 기준"을 "10분 기준"으로 받았다.
`degraded: true` 를 붙여 보내는 이유가 이것이다.

---

## 밟은 결함 둘

### 1. 오디오를 이중으로 감쌌다

`Malordered Data Received. Expected audio_content none was set.` 가 프레임 수만큼 반복됐다.

`@google-cloud/speech` 의 `streamingRecognize(config)` 가 돌려주는 것은 **원시 오디오를 받는 스트림**이다.
라이브러리가 내부에서 `{ audioContent }` 로 감싸 준다 (`build/src/helpers.js` 의 `PassThrough` 변환).

```js
current.write(buf)                    // 맞다
current.write({ audioContent: buf })  // 틀리다 — { audioContent: { audioContent } } 가 된다
```

감싼 채로 넘기면 `audio_content` 필드가 비어 Google 이 거절한다. **오류 문구가 그 말을 그대로 하고 있었다.**

설정을 인자로 넘기는 형태는 처음부터 맞았다. 라이브러리가 첫 쓰기 시점(`once('writing')`)에
`{ streamingConfig }` 를 먼저 보낸다.

### 2. 죽은 스트림에 계속 썼다

스트림이 죽은 뒤에도 오디오를 계속 쓰니 같은 오류가 **78번 반복돼 첫 오류가 묻혔다.**
`dead` 플래그로 쓰기를 멈추고 한 번만 알린다. 진짜 원인은 그 첫 줄에 있었다.

---

## 5분 한계와 회전

**Google 의 스트리밍 인식은 약 305초에서 끊긴다.** 5분 넘는 미팅이 백업의 존재 이유이므로 그냥 둘 수 없다.

240초(7,680,000바이트 = 16kHz linear16 모노)마다 새 스트림을 열고 갈아탄다.
이전 스트림은 `end()` 만 하고 파괴하지 않는다 — 남은 결과가 흘러나올 시간을 준다.
물러난 스트림의 뒤늦은 오류는 무시한다(`s !== current`). 현재 스트림만 세션을 끝낼 수 있다.

회전하면 화자 번호가 새로 매겨진다. 그래서 화자 분리를 아예 켜지 않고 `speaker: null` 로 보낸다 —
이어지지 않는 번호는 없느니만 못하다.

---

## 백업 경로를 시험하는 법

```bash
gcloud run services update sep-v2-stream --region asia-northeast3 --update-env-vars STT_ENGINE=google
# ... 시험 ...
gcloud run services update sep-v2-stream --region asia-northeast3 --remove-env-vars STT_ENGINE
```

**시크릿을 뺐다 넣었다 하지 않는다.** 그러다 주경로가 깨진 채로 남는다 — 실제로 한 번 그랬다.
`STT_ENGINE` 이 비어 있는 것이 기본값이고, 그때만 Deepgram 이 먼저 시도된다.

---

## 자격증명

**키 파일이 없다.** Cloud Run 의 기본 자격증명(ADC)으로 붙는다.
서비스 계정에 `roles/speech.client` 만 있으면 된다 — 만들고 보관하고 교체할 키 자체가 없다.

Workers 시절에는 서비스 계정 JSON 을 시크릿에 넣어야 했다. 그 경로(`worker/src/services/googleStt.ts`)는
이제 쓰이지 않으며 DO 제거와 함께 지운다.
