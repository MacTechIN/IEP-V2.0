// 실제 미팅 녹음을 실시간 속도로 흘려보내며 전사를 받아 본다.
import { readFileSync } from 'fs'
import WebSocket from 'ws'

const [, , pcmPath, token, url] = process.argv
const pcm = readFileSync(pcmPath)
const FRAME = 3200 // 100ms @ 16kHz linear16

const ws = new WebSocket(`${url}/api/v2/stream?token=${token}`, {
  headers: { Origin: 'https://iep-web.pages.dev' },
})

const t0 = Date.now()
let firstAt = null, finals = 0, interim = 0, chars = 0, engine = '?', degraded = false
const speakers = new Set()
const lines = []

ws.on('open', () => {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] 연결됨`)
  let off = 0
  const timer = setInterval(() => {
    if (off >= pcm.length) {
      clearInterval(timer)
      ws.send(JSON.stringify({ type: 'stop' }))
      // 마지막 결과가 흘러나올 시간을 준다
      setTimeout(() => ws.close(), 8000)
      return
    }
    ws.send(pcm.subarray(off, off + FRAME))
    off += FRAME
  }, 100)
})

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  const at = ((Date.now() - t0) / 1000).toFixed(1)
  if (m.type === 'ready') {
    engine = m.engine
    degraded = !!m.degraded
    console.log(`[${at}s] 준비됨 — 엔진 ${m.engine}${m.degraded ? ' (degraded)' : ''}`)
  } else if (m.type === 'transcript') {
    if (firstAt === null) { firstAt = at; console.log(`[${at}s] 첫 전사`) }
    if (m.is_final) {
      finals++
      chars += m.text.length
      lines.push(m.text)
      if (m.speaker != null) speakers.add(m.speaker)
      if (finals <= 6 || finals % 10 === 0) console.log(`  [${at}s] #${finals} ${m.text}`)
    } else interim++
  } else if (m.type === 'error') {
    console.log(`[${at}s] 오류: ${m.message}`)
  }
})

ws.on('close', () => {
  console.log(`\n── 결과 ──`)
  console.log(`엔진        ${engine}${degraded ? ' (degraded)' : ''}`)
  console.log(`첫 전사     ${firstAt ?? '없음'}초`)
  console.log(`최종 전사   ${finals}건 (중간 ${interim}건)`)
  console.log(`화자        ${speakers.size ? [...speakers].join(', ') : '표시 없음'}`)
  console.log(`글자 수     ${chars}`)
  console.log(`총 시간     ${((Date.now() - t0) / 1000).toFixed(0)}초 (오디오 ${(pcm.length / 32000).toFixed(0)}초)`)
  console.log(`\n전문:\n${lines.join(' ')}`)
  process.exit(0)
})

ws.on('error', (e) => { console.log('소켓 오류:', e.message); process.exit(1) })
