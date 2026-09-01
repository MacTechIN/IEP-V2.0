// 폴백이 **실제로 넘어가는지** 본다.
//
// 왜 이 시험이 필요한가 (2026-08-22)
//   2026-08-10 에 Google 백업을 "검증 완료" 로 적었다. 그런데 그때 쓴 방법이
//   `STT_ENGINE=google` 이었다 — **주경로를 통째로 건너뛰고** Google 릴레이만 본 것이다.
//   넘어가는 길 자체는 한 번도 지나가 보지 않았고, 거기에 결함 둘이 있었다.
//
//     1. `dg.on('close')` 가 넘겨준 뒤에도 클라이언트를 끊었다.
//        `ws` 는 연결 실패에서 error 다음에 close 를 낸다 — error 에서 백업을 붙여 놓고
//        close 에서 그 연결을 곧바로 끊었다. **폴백이 있는데 한 글자도 못 받는다.**
//     2. 열리기 전에 모아 둔 오디오를 백업에 안 넘겼다. 연결 실패는 대개 처음 몇 초 안에
//        나므로, 그동안 말한 것이 통째로 사라진다.
//
//   목적지만 보고 길을 안 본 시험이었다. 그래서 길을 본다.
//
// 실행: node tests/fallback.test.mjs   (Google 자격증명 없이 돈다 — 넘어갔는지만 본다)

import { spawn } from 'child_process'
import WebSocket from 'ws'
import jwt from 'jsonwebtoken'

const PORT = 8791
const SECRET = 'test-secret-for-fallback'
const ORIGIN = 'http://localhost:5173'
let failures = 0

const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✘'} ${msg}`)
  if (!cond) failures++
}

// **닿을 수 없는 주소를 준다.** 이러면 Deepgram 연결이 열리기 전에 실패하고,
// 그게 폴백이 돌아야 하는 바로 그 조건이다.
const server = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: ORIGIN,
    DEEPGRAM_API_KEY: 'dummy-key-not-used',
    DEEPGRAM_URL: 'wss://127.0.0.1:1/v1/listen',   // 즉시 거절된다
    // **Google 을 켜 둔다.** 끄면 `relayGoogle` 이 그 자리에서 알리고 스스로 닫아 버려,
    // 결함이 있든 없든 클라이언트가 닫힌다 — 두 경우가 구별되지 않는다.
    // (처음에 끄고 짰다가 결함을 심어도 통과해서 알았다. 시험이 아니었다.)
    // 켜 두면 자격증명이 없어도 `ready` 를 먼저 보내고 **연결을 열어 둔 채** 오류를 알리므로,
    // "넘긴 뒤에도 살아 있는가" 를 직접 볼 수 있다.
    GOOGLE_STT_ENABLED: 'true',
    GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent-on-purpose.json',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
server.stdout.on('data', (d) => { log += d })
server.stderr.on('data', (d) => { log += d })

const token = jwt.sign({ email: 't@t.test', role: 'user', kind: 'access' }, SECRET,
  { subject: '00000000-0000-0000-0000-000000000000', expiresIn: 300 })

await new Promise((r) => setTimeout(r, 1500))

const result = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/v2/stream?token=${token}`,
    { headers: { Origin: ORIGIN } })
  const seen = []
  let closedAt = null
  ws.on('open', () => {
    // 주경로가 아직 열리지 않은 시점에 오디오를 보낸다 — 이게 `pending` 에 쌓인다.
    ws.send(Buffer.alloc(3200))
    ws.send(Buffer.alloc(3200))
  })
  ws.on('message', (raw) => { try { seen.push(JSON.parse(raw.toString())) } catch { /* ignore */ } })
  ws.on('close', () => { closedAt ??= Date.now(); resolve({ seen, closed: true }) })
  // 넘긴 뒤 **연결이 살아 있어야 한다.** 결함이 있으면 여기 오기 전에 close 가 온다.
  setTimeout(() => resolve({ seen, closed: false }), 4000)
})

console.log('\n── 폴백 경로 ──')

// 1) 넘어갔다는 흔적이 로그에 있어야 한다 (프레임을 함께 들고 갔는지까지)
ok(/deepgram handoff → google/.test(log), 'Deepgram 실패에서 Google 로 넘어갔다')
ok(/2 frame\(s\) carried/.test(log),
  '열리기 전에 받은 프레임 2개를 함께 넘겼다 (첫 문장을 잃지 않는다)')

// 2) 백업이 실제로 붙었다고 알렸는가
const ready = result.seen.find((m) => m.type === 'ready')
ok(ready?.engine === 'google' && ready?.degraded === true,
  `백업이 붙었다고 알린다 — engine=google, degraded=true (받은 값: ${JSON.stringify(ready) ?? '없음'})`)

// 3) **이 시험의 핵심.** 넘긴 뒤에도 연결이 살아 있어야 한다.
//    결함이 있으면 `dg.on('close')` 가 방금 넘겨준 연결을 곧바로 끊는다 —
//    사용자 쪽에서는 폴백이 있는데 한 글자도 안 오는 모습이 된다.
ok(!result.closed, '넘긴 뒤 4초가 지나도 연결이 살아 있다 (close 가 끊지 않았다)')

server.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 300))

if (failures) {
  console.log(`\n✘ ${failures}개 실패\n\n── 서버 로그 ──\n${log}`)
  process.exit(1)
}
console.log('\n✓ 폴백 경로 통과')
process.exit(0)
