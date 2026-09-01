// 실시간 전사 게이트웨이 — Cloud Run
//
// 브라우저 오디오(linear16 16kHz) → Deepgram 스트리밍 → 클라이언트로 전사 반환.
// Deepgram 이 안 되면 Google STT v2 **진짜 스트리밍**으로 넘어간다.
//
// **왜 Workers 가 아니라 여기인가**
//   Workers 에는 연결을 듣는 소켓이 없어 `ws` 가 통째로 못 돈다. 그래서 Durable Object 로
//   우회했고, 그 과정에서 세 가지를 연달아 밟았다 —
//   `fetch` 가 `wss://` 를 거부하고, 101 을 반환하면 인스턴스가 정리되며 업스트림 리스너가 죽고,
//   이진 프레임이 Blob 으로 와서 `send()` 시 `"[object Blob]"` 문자열이 나갔다.
//   Cloud Run 에는 그 제약이 없다. 사내 원본 코드가 거의 그대로 돈다.
//
// **Google 백업이 여기서는 진짜 스트리밍이다.**
//   Workers 는 gRPC 를 못 해서 10초 버퍼 REST 로 우회해야 했다. 여기서는 `StreamingRecognize` 를
//   그대로 쓴다 — 지연이 버퍼 길이가 아니라 수백 ms 다.
//   그리고 **서비스 계정 키 파일이 필요 없다.** Cloud Run 의 기본 자격증명(ADC)이 붙는다.

import { createServer, IncomingMessage } from 'http'
import { WebSocketServer, WebSocket, RawData } from 'ws'
import jwt from 'jsonwebtoken'
import { SpeechClient } from '@google-cloud/speech'

const PORT = Number(process.env.PORT || 8080)
const JWT_SECRET = process.env.JWT_SECRET || ''
const STREAM_PATH = '/api/v2/stream'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''
const DG_MODEL = process.env.DEEPGRAM_MODEL || 'nova-2'
const DG_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || 'ko'
const DG_KEEPALIVE_MS = 8000

const GOOGLE_ENABLED = process.env.GOOGLE_STT_ENABLED !== 'false'
const GOOGLE_LANGUAGE = process.env.GOOGLE_STT_LANGUAGE || 'ko-KR'

// 브라우저가 보내는 형식. linear16 모노 16kHz = 초당 32,000 바이트.
const SAMPLE_RATE = 16000
const BYTES_PER_SEC = SAMPLE_RATE * 2
// Google 스트리밍 인식의 상한은 약 305초다. 240초에서 갈아탄다.
const ROTATE_BYTES = BYTES_PER_SEC * 240

const FORCE_ENGINE = process.env.STT_ENGINE || ''

// **주소를 밖으로 뺀다.** 박혀 있으면 연결 실패를 만들어 볼 방법이 없고,
// 그러면 폴백이 실제로 사는지 시험할 수가 없다 — 2026-08-10 에 백업을 "검증했다" 고 적었지만
// 실제로는 `STT_ENGINE=google` 로 **주경로를 건너뛰고** Google 릴레이만 본 것이었다.
// 넘어가는 길 자체는 한 번도 지나가 보지 않았고, 거기에 결함 둘이 있었다 (V3 세션이 짚었다).
const DG_BASE = process.env.DEEPGRAM_URL || 'wss://api.deepgram.com/v1/listen'

function deepgramUrl(): string {
  const p = new URLSearchParams({
    model: DG_MODEL, language: DG_LANGUAGE,
    diarize: 'true', punctuate: 'true', smart_format: 'true', interim_results: 'true',
    encoding: 'linear16', sample_rate: String(SAMPLE_RATE), channels: '1',
  })
  return `${DG_BASE}?${p}`
}

const send = (ws: WebSocket, obj: unknown) => {
  if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)) } catch { /* ignore */ } }
}

// ───────────────────────────── Deepgram (주경로)

function relayDeepgram(client: WebSocket, onFail: (carry: Buffer[]) => void): boolean {
  if (!DEEPGRAM_API_KEY) return false

  const dg = new WebSocket(deepgramUrl(), { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } })
  let ready = false
  let handedOff = false
  const pending: Buffer[] = []
  let keepAlive: NodeJS.Timeout | null = null
  const stop = () => { if (keepAlive) { clearInterval(keepAlive); keepAlive = null } }

  // 열리기 전에 실패하면 백업으로 넘긴다. 열린 뒤 끊기면 그냥 종료다 —
  // 중간에 엔진을 바꾸면 화자 번호 체계가 갈아엎어져 녹취가 더 혼란스러워진다.
  dg.on('error', (e) => {
    console.error('deepgram error:', (e as Error).message)
    stop()
    if (!ready && !handedOff) {
      handedOff = true
      // **모아 둔 오디오를 함께 넘긴다.** 연결 실패는 대개 처음 몇 초 안에 나는데,
      // 그동안 받은 프레임을 버리면 백업이 **첫 문장을 잃은 채로 시작한다.**
      const carry = pending.splice(0)
      console.warn(`deepgram handoff → google (${carry.length} frame(s) carried)`)
      onFail(carry)
    } else send(client, { type: 'error', message: 'stt_error' })
  })

  dg.on('open', () => {
    ready = true
    for (const b of pending) dg.send(b)
    pending.length = 0
    send(client, { type: 'ready', engine: 'deepgram' })
    keepAlive = setInterval(() => {
      try { if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: 'KeepAlive' })) } catch { /* ignore */ }
    }, DG_KEEPALIVE_MS)
    console.log('deepgram stream opened')
  })

  dg.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'Error') {
        console.error(`deepgram: ${msg.variant} ${String(msg.description).slice(0, 120)}`)
        return
      }
      const alt = msg.channel?.alternatives?.[0]
      if (alt?.transcript?.trim()) {
        send(client, {
          type: 'transcript', text: alt.transcript,
          is_final: !!msg.is_final, speech_final: !!msg.speech_final,
          speaker: alt.words?.[0]?.speaker ?? null,
          start: msg.start, duration: msg.duration, engine: 'deepgram',
        })
      }
    } catch { /* JSON 이 아니면 무시 */ }
  })

  // **넘긴 뒤에는 클라이언트를 건드리지 않는다.**
  // `ws` 는 연결 실패에서 `error` 다음에 `close` 를 낸다. 가드가 없으면 error 에서 백업을
  // 붙여 놓고 close 에서 그 연결을 곧바로 끊는다 — **폴백이 있는데 한 글자도 못 받는다.**
  // 2026-08-10 부터 있던 결함이고, 백업 검증이 주경로를 건너뛰어서 드러나지 않았다.
  dg.on('close', () => {
    stop()
    if (handedOff) return
    try { client.close() } catch { /* ignore */ }
  })

  client.on('message', (data: RawData, isBinary: boolean) => {
    if (handedOff) return
    if (isBinary) {
      const buf = data as Buffer
      if (ready) { try { dg.send(buf) } catch { /* ignore */ } } else pending.push(buf)
    } else {
      try {
        if (JSON.parse(data.toString()).type === 'stop' && dg.readyState === WebSocket.OPEN) {
          dg.send(JSON.stringify({ type: 'CloseStream' }))
        }
      } catch { /* ignore */ }
    }
  })

  client.on('close', () => {
    stop()
    try {
      if (dg.readyState === WebSocket.OPEN) { dg.send(JSON.stringify({ type: 'CloseStream' })); dg.close() }
      else dg.terminate()
    } catch { /* ignore */ }
  })

  return true
}

// ───────────────────────────── Google STT v2 (백업)

let speech: SpeechClient | null = null

/**
 * @param carry 주경로가 열리기 전에 받아 둔 프레임. 넘겨받았으면 **먼저 흘려보낸다** —
 *   버리면 백업이 첫 문장을 잃은 채로 시작한다.
 */
function relayGoogle(client: WebSocket, carry: Buffer[] = []): void {
  if (!GOOGLE_ENABLED) {
    send(client, { type: 'error', message: 'stt_unavailable' })
    try { client.close() } catch { /* ignore */ }
    return
  }
  // 키 파일이 없다. Cloud Run 의 기본 자격증명(ADC)을 쓴다 —
  // 서비스 계정에 roles/speech.client 만 붙이면 된다.
  speech ??= new SpeechClient()

  // 화자 분리는 켜지 않는다 — 아래 회전 때문에 어차피 조각 간 화자 번호가 이어지지 않는다.
  // 주경로(Deepgram)는 화자를 그대로 준다.
  const config = {
    config: {
      encoding: 'LINEAR16' as const,
      sampleRateHertz: SAMPLE_RATE,
      languageCode: GOOGLE_LANGUAGE,
      enableAutomaticPunctuation: true,
    },
    interimResults: true,
  }

  // 스트림이 죽은 뒤에도 오디오를 계속 쓰면 같은 오류가 프레임 수만큼 반복된다.
  // 실제로 78번 반복돼 **첫 오류(진짜 원인)가 묻혔다.** 죽으면 쓰기를 멈추고 한 번만 알린다.
  let dead = false
  let current: ReturnType<SpeechClient['streamingRecognize']> | null = null
  let writtenBytes = 0

  function open(): ReturnType<SpeechClient['streamingRecognize']> {
    const s = speech!.streamingRecognize(config)

    s.on('data', (res: {
      results?: { alternatives?: { transcript?: string }[]; isFinal?: boolean }[]
    }) => {
      for (const r of res.results || []) {
        const alt = r.alternatives?.[0]
        if (!alt?.transcript?.trim()) continue
        send(client, {
          type: 'transcript', text: alt.transcript,
          is_final: !!r.isFinal, speech_final: !!r.isFinal,
          speaker: null,
          // 주경로와 품질이 다르다는 것을 화면이 알 수 있게 한다
          engine: 'google', degraded: true,
        })
      }
    })

    s.on('error', (e: Error) => {
      // 회전으로 물러난 스트림의 뒤늦은 오류는 무시한다. 현재 스트림만 세션을 끝낼 수 있다.
      if (s !== current || dead) return
      dead = true
      console.error('google stt error:', e.message)
      send(client, { type: 'error', message: 'stt_error' })
    })

    current = s
    writtenBytes = 0
    return s
  }

  const first = open()
  // 넘겨받은 프레임을 먼저 쓴다. 회전 계산에도 그대로 넣는다 — 안 넣으면 240초 경계가 어긋난다.
  for (const b of carry) {
    try { first.write(b) } catch { /* ignore */ }
    writtenBytes += b.length
  }
  send(client, { type: 'ready', engine: 'google', degraded: true })
  console.log(`google stt stream opened (fallback${carry.length ? `, ${carry.length} frame(s) carried` : ''})`)

  client.on('message', (data: RawData, isBinary: boolean) => {
    if (dead) return
    if (isBinary) {
      const buf = data as Buffer
      // **원시 버퍼를 그대로 쓴다.** 라이브러리가 `{ audioContent }` 로 감싸 준다.
      // 여기서 미리 감싸면 `{ audioContent: { audioContent } }` 가 되어 필드가 비고,
      // Google 이 "Malordered Data Received. Expected audio_content none was set" 로 거절한다.
      try { current?.write(buf) } catch { /* ignore */ }

      // Google 의 스트리밍 인식은 **약 5분에서 끊긴다.** 그 전에 갈아탄다 —
      // 안 그러면 5분 넘는 미팅에서 백업이 조용히 죽는다(백업으로서 의미가 없어진다).
      // 이전 스트림은 남은 결과를 흘려보내도록 `end()` 만 하고 파괴하지 않는다.
      writtenBytes += buf.length
      if (writtenBytes >= ROTATE_BYTES) {
        const old = current
        open()
        try { old?.end() } catch { /* ignore */ }
        console.log('google stt stream rotated (5분 한계 회피)')
      }
    } else {
      try { if (JSON.parse(data.toString()).type === 'stop') current?.end() } catch { /* ignore */ }
    }
  })
  client.on('close', () => { try { current?.end() } catch { /* ignore */ } })
}

// ───────────────────────────── 서버

const server = createServer((req, res) => {
  // Cloud Run 헬스체크. 살아 있는지만 알린다.
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return }
  res.writeHead(404); res.end()
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  let url: URL
  try { url = new URL(req.url || '', 'http://localhost') } catch { socket.destroy(); return }
  if (url.pathname !== STREAM_PATH) { socket.destroy(); return }

  // 허용한 오리진만. 목록이 비어 있으면 검사하지 않는다(로컬 개발).
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return
  }

  // 쿼리스트링 토큰은 **옛 방식**이다. 아직 받는 이유는 아래 `AUTH_IN_URL` 주석에 있다.
  const token = url.searchParams.get('token')

  if (token) {
    if (!verifyAccess(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req, true))
    return
  }

  // 토큰이 없으면 **붙이기는 하되 아무것도 시작하지 않는다.** 첫 메시지로 인증받는다.
  wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req, false))
})

/**
 * **액세스 토큰만 받는다.** 서명만 보면 리프레시 토큰(수명 30일)으로도 열린다 —
 * Worker 쪽에서 종류를 나눈 것과 같은 이유다 (2026-08-22).
 */
function verifyAccess(token: string | null | undefined): boolean {
  try {
    if (!token || !JWT_SECRET) return false
    const claims = jwt.verify(token, JWT_SECRET) as { kind?: string }
    return claims.kind === 'access'
  } catch { return false }
}

function startRelay(client: WebSocket) {
  // 백업 경로를 검증할 때 쓴다. 이게 없으면 시크릿을 뺐다 넣었다 해야 하고,
  // 그러다 **주경로가 깨진 채로 남는다.** 기본값은 비어 있다.
  if (FORCE_ENGINE === 'google') { relayGoogle(client); return }

  // 주경로를 먼저. 연결 자체가 안 되면 백업으로 넘어간다.
  if (!relayDeepgram(client, (carry) => relayGoogle(client, carry))) {
    console.warn('DEEPGRAM_API_KEY 가 없어 백업으로 시작합니다')
    relayGoogle(client)
  }
}

/**
 * 인증을 **첫 메시지로** 받는다.
 *
 * ── 왜 옮겼나 (2026-08-26) ──
 *
 * 쿼리스트링에 토큰을 실으면 **요청 URL 전체가 로그에 남는다.** Cloud Run 요청 로그에서
 * 실제로 확인했다 — 유효기간이 남은 액세스 토큰이 평문으로 찍혀 있었다.
 * 로그 열람 권한이 있는 사람은 그 사이 그 토큰을 그대로 쓸 수 있다.
 * 브라우저 기록·프록시·CDN 도 같은 자리다.
 *
 * WebSocket 업그레이드에는 `Authorization` 헤더를 붙일 수 없어서 쿼리로 보냈던 것인데,
 * **붙은 다음 첫 메시지로 보내면 헤더가 필요 없다.** 본문은 로그에 안 남는다.
 *
 * ── 왜 옛 방식을 아직 받나 (`AUTH_IN_URL`) ──
 *
 * 화면 번들은 해시로 배포된다. **이미 열려 있는 탭은 옛 코드를 들고 있다.**
 * 지금 끊으면 상담 중인 사람의 자막이 그 자리에서 멎는다.
 * 새 번들만 도는 것이 확실해지면 위 `if (token)` 가지를 지운다.
 *
 * ── 인증 전에는 한 바이트도 흘리지 않는다 ──
 *
 * 오디오가 먼저 오면 끊는다. Deepgram 연결도 인증 뒤에 연다 —
 * 안 그러면 **인증 안 된 연결이 STT 요금을 쓴다.**
 */
const AUTH_TIMEOUT_MS = 5000

wss.on('connection', (client: WebSocket, _req: IncomingMessage, authed: boolean) => {
  if (authed) { startRelay(client); return }

  const shut = (reason: string) => {
    try { client.send(JSON.stringify({ type: 'error', message: 'unauthorized' })) } catch { /* ignore */ }
    try { client.close(4401, reason) } catch { /* ignore */ }
    try { client.terminate() } catch { /* ignore */ }
  }

  const timer = setTimeout(() => shut('auth timeout'), AUTH_TIMEOUT_MS)

  const onFirst = (raw: unknown, isBinary?: boolean) => {
    clearTimeout(timer)
    client.off('message', onFirst)
    // 오디오(바이너리)가 먼저 왔다 — 인증 전에는 받지 않는다
    if (isBinary) { shut('audio before auth'); return }
    let msg: { type?: string; token?: string } | null = null
    try { msg = JSON.parse(String(raw)) } catch { /* 아래에서 끊는다 */ }
    if (msg?.type !== 'auth' || !verifyAccess(msg.token)) { shut('bad auth'); return }
    startRelay(client)
  }
  client.on('message', onFirst)
})

server.listen(PORT, () => {
  console.log(`stream gateway on :${PORT}${STREAM_PATH}`)
  console.log(`  deepgram: ${DEEPGRAM_API_KEY ? `${DG_MODEL}/${DG_LANGUAGE}` : '미설정'}`)
  console.log(`  google  : ${GOOGLE_ENABLED ? `${GOOGLE_LANGUAGE} (ADC)` : '비활성'}`)
})
