// 실시간 자막 — Cloud Run 스트림 게이트웨이에 붙어 전사를 받아 온다.
//
// 게이트웨이는 **linear16 모노 16kHz** 원시 PCM 만 받는다(Deepgram·Google 양쪽 다 그 형식으로 연다).
// 그런데 브라우저의 MediaRecorder 는 webm/opus 로 압축해서 준다 — 그대로 보내면 잡음만 나온다.
// 그래서 여기서 직접 변환한다.
//
//   getUserMedia 스트림 → AudioContext(16kHz) → AudioWorklet → Float32 → Int16 → 100ms 프레임
//
// AudioContext 에 sampleRate 를 지정하면 브라우저가 리샘플링까지 해 준다. 직접 하면 품질이 나빠진다.
// 워클릿 코드는 별도 파일 대신 Blob URL 로 넣는다 — 번들러 설정에 기대지 않으려는 것이다.
//
// **녹음과는 완전히 별개다.** 같은 MediaStream 을 읽기만 하고, 이쪽이 실패해도 녹음은 계속 돌아간다.
// 실시간 자막은 보조 기능이고, 녹음이 본체다.

// 워클릿은 한 번에 128프레임씩 불린다 — 그대로 보내면 초당 375번 postMessage 하게 된다.
// 여기서 100ms(1600샘플) 모아 한 번에 넘긴다. 게이트웨이가 기대하는 프레임 크기와도 같다.
const WORKLET = `
const CHUNK = 1600
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(CHUNK); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        // Float32(-1..1) → Int16. 클리핑을 안 하면 큰 소리에서 값이 뒤집힌다.
        const s = Math.max(-1, Math.min(1, ch[i]))
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
        if (this.n === CHUNK) {
          const out = this.buf
          this.port.postMessage(out.buffer, [out.buffer])
          this.buf = new Int16Array(CHUNK)   // 넘긴 버퍼는 detach 된다. 새로 잡아야 한다.
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('pcm-tap', PcmTap)
`

export interface TranscriptLine {
  id: string
  text: string
  speaker: number | null
  /** 확정 전 임시 결과. 다음 결과로 덮이며, 확정되면 굳는다. */
  interim: boolean
}

export interface LiveTranscriptHandlers {
  onLine: (lines: TranscriptLine[]) => void
  onStatus: (s: {
    state: 'connecting' | 'live' | 'closed' | 'error'
    engine?: string; degraded?: boolean; message?: string
    /** 몇 번째 재연결인가. 0 이면 처음 붙는 중이다 — 화면 문구가 이 값으로 갈린다 */
    retry?: number
  }) => void
}

const SAMPLE_RATE = 16000
/** 100ms 어치. 게이트웨이의 테스트 도구와 같은 크기다. */
const FRAME_BYTES = 3200

export class LiveTranscript {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private src: MediaStreamAudioSourceNode | null = null
  private buf: Uint8Array[] = []
  private bufBytes = 0
  private lines: TranscriptLine[] = []
  private seq = 0
  private stopped = false
  private audioStarted = false
  private pendingStream: MediaStream | null = null
  /** 재연결에 필요한 것들. `start()` 가 받은 값을 그대로 들고 있는다. */
  private url = ''
  private token = ''
  private retries = 0
  private retryTimer: number | null = null

  constructor(private h: LiveTranscriptHandlers) {}

  async start(stream: MediaStream, url: string, token: string) {
    this.stopped = false
    this.audioStarted = false
    this.pendingStream = stream
    this.url = url
    this.token = token
    this.retries = 0
    this.connect()
  }

  /**
   * 끊기면 **다시 붙는다.**
   *
   * ── 왜 필요한가 (2026-08-26 실측) ──
   *
   * Cloud Run 은 WebSocket 을 **끝나지 않는 요청 하나**로 본다. 요청 제한시간이 지나면
   * 인프라가 그 연결을 끊는데, **끊은 것이 앱 밖이라 서버 로그에는 아무것도 남지 않는다.**
   * 배포 당시 제한시간이 기본값 300초여서 **자막이 정확히 5분 만에 죽었다.**
   * 제한시간은 3600초로 올렸지만, 그것만으로는 부족하다 —
   *
   *   · 상담이 한 시간을 넘길 수 있다
   *   · **폰은 지하철·엘리베이터에서 수시로 끊긴다**
   *   · 화면을 잠그면 브라우저가 소켓을 정리한다
   *
   * 전에는 `onclose` 가 「끊김」이라고 **표시만 하고 끝났다.** 그러면 상담 나머지 전부가
   * 자막 없이 지나가고, 사용자는 그것을 **한참 뒤에야 알아챈다.**
   *
   * ── 어떻게 ──
   *
   * 1·2·4·8·16초로 늘리며 최대 6번 다시 붙는다(합쳐 약 1분).
   * **녹음은 이것과 무관하게 계속 돈다** — 자막은 보기용이고, 저장되는 전사는
   * 녹음이 끝난 뒤 서버가 다시 만든다. 그래서 재연결이 실패해도 상담 기록은 온전하다.
   */
  private connect() {
    if (this.stopped) return
    this.h.onStatus({ state: 'connecting' })

    // **토큰을 주소에 싣지 않는다.** 쿼리스트링에 실으면 요청 URL 전체가 로그에 남는다 —
    // Cloud Run 요청 로그에서 유효기간이 남은 액세스 토큰이 평문으로 찍힌 것을 확인했다
    // (2026-08-26). 브라우저 기록·프록시·CDN 도 같은 자리다.
    // 붙은 다음 **첫 메시지로** 보내면 헤더가 필요 없고 본문은 로그에 안 남는다.
    const ws = new WebSocket(`${this.url.replace(/\/$/, '')}/api/v2/stream`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      // 인증이 먼저다. **오디오는 `ready` 를 받고 나서 보낸다** —
      // 서버가 인증 전 바이너리를 받으면 끊는다.
      try { ws.send(JSON.stringify({ type: 'auth', token: this.token })) } catch { /* onerror 가 받는다 */ }
    }
    ws.onmessage = (ev) => this.onMessage(ev)
    // `onerror` 뒤에는 반드시 `onclose` 가 온다 — 여기서 상태를 덮으면 재연결 안내가 지워진다.
    ws.onerror = () => { /* onclose 가 받는다 */ }
    ws.onclose = () => {
      if (this.stopped) return
      if (this.ws !== ws) return          // 이미 새 소켓으로 갈아탄 뒤의 옛 close
      this.scheduleRetry()
    }
  }

  private scheduleRetry() {
    const MAX = 6
    if (this.retries >= MAX) {
      this.h.onStatus({
        state: 'error',
        message: '자막 연결이 끊겼습니다. 녹음은 계속되고 있습니다.',
      })
      return
    }
    const wait = Math.min(16000, 1000 * 2 ** this.retries)
    this.retries += 1
    this.h.onStatus({ state: 'connecting', retry: this.retries })
    if (this.retryTimer) window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.connect(), wait)
  }

  private onMessage(ev: MessageEvent) {
    let m: any
    try { m = JSON.parse(String(ev.data)) } catch { return }

    if (m.type === 'ready') {
      // 한 번 붙었으면 셈을 되돌린다. 안 그러면 긴 상담에서 여섯 번째 끊김에 포기해 버린다.
      this.retries = 0
      this.h.onStatus({ state: 'live', engine: m.engine, degraded: !!m.degraded })
      // 인증이 끝나고 엔진이 열렸다. **이제부터 오디오를 보낸다.**
      if (!this.audioStarted && this.pendingStream) {
        this.audioStarted = true
        void this.startAudio(this.pendingStream)
      }
      return
    }
    if (m.type === 'error') {
      this.h.onStatus({
        state: 'error',
        message: m.message === 'stt_unavailable' ? '전사 엔진에 연결할 수 없습니다' : '전사 중 오류가 났습니다',
      })
      return
    }
    if (m.type !== 'transcript' || !String(m.text || '').trim()) return

    // 임시 결과는 **맨 끝 한 줄만** 유지한다. 쌓아 두면 같은 말이 여러 번 보인다.
    const last = this.lines[this.lines.length - 1]
    if (last?.interim) this.lines.pop()
    this.lines.push({
      id: `l${this.seq++}`, text: String(m.text), speaker: m.speaker ?? null, interim: !m.is_final,
    })
    // 화면에 남기는 줄 수를 제한한다. 긴 미팅에서 DOM 이 수천 줄이 되면 스크롤이 버벅인다.
    if (this.lines.length > 300) this.lines = this.lines.slice(-300)
    this.h.onLine([...this.lines])
  }

  private async startAudio(stream: MediaStream) {
    try {
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      this.ctx = ctx
      // 사용자 제스처에서 몇 단계 떨어져 시작하면 suspended 로 열린다 — 그러면 아무 소리도 안 흐른다.
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      const blobUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      try { await ctx.audioWorklet.addModule(blobUrl) } finally { URL.revokeObjectURL(blobUrl) }

      this.src = ctx.createMediaStreamSource(stream)
      this.node = new AudioWorkletNode(ctx, 'pcm-tap')
      this.node.port.onmessage = (e) => this.push(new Uint8Array(e.data as ArrayBuffer))
      this.src.connect(this.node)
      // 워클릿을 목적지에 잇지 않으면 브라우저가 그래프를 놀리는 것으로 보고 멈출 수 있다.
      // 소리를 다시 내보내면 하울링이 나므로 무음 게인을 거쳐 목적지에 붙인다.
      const mute = ctx.createGain()
      mute.gain.value = 0
      this.node.connect(mute).connect(ctx.destination)
    } catch (e) {
      this.h.onStatus({ state: 'error', message: '마이크 오디오를 변환할 수 없습니다' })
    }
  }

  /** 100ms 단위로 모아서 보낸다. 워클릿이 주는 조각(128프레임)은 너무 잘아 그대로 보내면 낭비다. */
  private push(chunk: Uint8Array) {
    this.buf.push(chunk)
    this.bufBytes += chunk.byteLength
    while (this.bufBytes >= FRAME_BYTES) {
      const merged = new Uint8Array(this.bufBytes)
      let off = 0
      for (const b of this.buf) { merged.set(b, off); off += b.byteLength }
      const frame = merged.subarray(0, FRAME_BYTES)
      const rest = merged.subarray(FRAME_BYTES)
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame)
      this.buf = rest.byteLength ? [rest] : []
      this.bufBytes = rest.byteLength
    }
  }

  stop() {
    this.stopped = true
    // 예약된 재연결을 취소한다. 안 그러면 녹음을 멈춘 뒤에 다시 붙어 요금이 나간다.
    if (this.retryTimer) { window.clearTimeout(this.retryTimer); this.retryTimer = null }
    try { this.ws?.send(JSON.stringify({ type: 'stop' })) } catch { /* 이미 닫혔다 */ }
    try { this.node?.disconnect(); this.src?.disconnect() } catch { /* ignore */ }
    // 컨텍스트는 비동기로 닫힌다. 실패해도 페이지를 떠나면 정리된다.
    void this.ctx?.close().catch(() => {})
    this.ctx = null; this.node = null; this.src = null
    // 마지막 확정 결과가 흘러나올 틈을 준다. 곧바로 닫으면 끝문장이 잘린다.
    const ws = this.ws
    setTimeout(() => { try { ws?.close() } catch { /* ignore */ } }, 1500)
    this.ws = null
    this.h.onStatus({ state: 'closed' })
  }

  /** 지금까지 확정된 줄만. 임시 결과는 뺀다. */
  finalText(): string {
    return this.lines.filter((l) => !l.interim).map((l) => l.text).join(' ')
  }
}
