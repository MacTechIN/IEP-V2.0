// 인증이 **첫 메시지**로 오는 것을 본다.
//
// 왜 이 시험이 필요한가 (2026-08-26)
//   토큰을 쿼리스트링에 실었더니 **Cloud Run 요청 로그에 평문으로 찍혔다.**
//   유효기간이 남은 액세스 토큰이라 로그를 볼 수 있는 사람은 그대로 쓸 수 있다.
//   그래서 붙은 다음 첫 메시지로 받도록 옮겼다.
//
//   옮기면서 조용히 뚫릴 수 있는 자리가 셋이다 —
//     1. 인증 안 하고 그냥 오디오를 보내면? → **끊겨야 한다** (STT 요금이 나간다)
//     2. 아무 말도 안 하고 붙어만 있으면?   → **끊겨야 한다**
//     3. 가짜 토큰·리프레시 토큰이면?       → **끊겨야 한다**
//   셋 다 "연결은 됐다" 로 보이기 때문에 눈으로는 구별되지 않는다.
//
// 실행: node tests/auth.test.mjs

import { spawn } from 'child_process'
import WebSocket from 'ws'
import jwt from 'jsonwebtoken'

const PORT = 8792
const SECRET = 'test-secret-for-auth'
const ORIGIN = 'http://localhost:5173'
let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✘'} ${msg}`); if (!cond) failures++ }

const server = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT), JWT_SECRET: SECRET, ALLOWED_ORIGINS: ORIGIN,
    // Google 을 주엔진으로 쓴다 — 자격증명이 없어도 `ready` 를 보내고 연결을 열어 두므로
    // **인증이 통과했는지**를 `ready` 하나로 깨끗하게 본다.
    STT_ENGINE: 'google',
    GOOGLE_STT_ENABLED: 'true',
    GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent-on-purpose.json',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
server.stdout.on('data', (d) => { log += d })
server.stderr.on('data', (d) => { log += d })

const sign = (kind) => jwt.sign({ email: 't@t.test', role: 'user', kind }, SECRET,
  { subject: '00000000-0000-0000-0000-000000000000', expiresIn: 300 })
const access = sign('access')
const refresh = sign('refresh')

await new Promise((r) => setTimeout(r, 1500))

/**
 * 붙어서 `first` 를 보낸 뒤, `ready` 를 받는지 / 끊기는지 본다.
 * @param first 붙자마자 보낼 것. null 이면 아무것도 안 보낸다.
 */
function attempt(first, { url = `ws://127.0.0.1:${PORT}/api/v2/stream`, wait = 3000 } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { Origin: ORIGIN } })
    let ready = false
    let closed = null
    let http = null
    const done = () => resolve({ ready, closed, http })
    ws.on('open', () => { if (first !== null) ws.send(first) })
    ws.on('message', (m) => {
      try { if (JSON.parse(String(m)).type === 'ready') ready = true } catch { /* ignore */ }
    })
    ws.on('unexpected-response', (_, r) => { http = r.statusCode; done() })
    ws.on('error', () => { /* close 가 뒤따른다 */ })
    ws.on('close', (c) => { closed = c; done() })
    setTimeout(() => { try { ws.close() } catch { /* ignore */ } ; done() }, wait)
  })
}

// **먼저 서버가 살아 있는지 본다.**
// 이게 없으면 아래 「끊겨야 하는 것」 이 전부 통과한다 — 서버가 아예 안 떠 있어도
// 연결은 실패하고 닫히기 때문이다. 처음 짤 때 실제로 그렇게 나왔다 (2026-08-26).
const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.status).catch((e) => String(e))
if (health !== 200) {
  console.log(`\n✘ 서버가 뜨지 않았다 (/health → ${health})\n--- 서버 로그 ---\n${log}`)
  server.kill(); process.exit(1)
}

console.log('\n── 통과해야 하는 것 ──')
const good = await attempt(JSON.stringify({ type: 'auth', token: access }))
ok(good.ready, '첫 메시지로 액세스 토큰 → ready')
if (!good.ready) {
  // 정상 경로가 안 되면 아래 결과는 **아무 뜻이 없다.** 여기서 멈춘다.
  console.log(`\n✘ 정상 경로가 실패했다 — 아래 「끊겨야 하는 것」 은 판단할 수 없다`
            + `\n   받은 것: ${JSON.stringify(good)}\n--- 서버 로그 ---\n${log}`)
  server.kill(); process.exit(1)
}

const legacy = await attempt(null, { url: `ws://127.0.0.1:${PORT}/api/v2/stream?token=${access}` })
ok(legacy.ready, '옛 방식(쿼리 토큰)도 아직 통한다 — 열려 있는 탭이 끊기면 안 된다')

console.log('\n── 끊겨야 하는 것 ──')
const audioFirst = await attempt(Buffer.alloc(3200))
ok(!audioFirst.ready && audioFirst.closed !== null,
   '인증 없이 오디오부터 → 끊긴다 (인증 안 된 연결이 STT 요금을 쓰면 안 된다)')

const silent = await attempt(null, { wait: 7000 })
ok(!silent.ready && silent.closed !== null, '아무 말 없이 붙어만 있으면 → 시간 지나 끊긴다')

const fake = await attempt(JSON.stringify({ type: 'auth', token: 'not-a-token' }))
ok(!fake.ready && fake.closed !== null, '가짜 토큰 → 끊긴다')

const wrongKind = await attempt(JSON.stringify({ type: 'auth', token: refresh }))
ok(!wrongKind.ready && wrongKind.closed !== null,
   '리프레시 토큰(수명 30일) → 끊긴다. 서명만 보면 열린다')

const junk = await attempt('not json at all')
ok(!junk.ready && junk.closed !== null, 'JSON 이 아닌 것 → 끊긴다')

const badOrigin = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/v2/stream`, { headers: { Origin: 'http://evil.test' } })
  ws.on('unexpected-response', (_, r) => resolve(r.statusCode))
  ws.on('error', () => resolve('error'))
  ws.on('open', () => resolve('opened'))
  setTimeout(() => resolve('timeout'), 3000)
})
ok(badOrigin === 403, `낯선 Origin → 403 (받은 것: ${badOrigin})`)

server.kill()
await new Promise((r) => setTimeout(r, 200))
if (failures) {
  console.log(`\n✘ ${failures}개 실패\n--- 서버 로그 ---\n${log}`)
  process.exit(1)
}
console.log('\n✓ 인증 통과 — 토큰은 주소가 아니라 첫 메시지로 온다')
