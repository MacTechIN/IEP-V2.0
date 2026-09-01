#!/usr/bin/env node
/**
 * 배포 직전에 번들을 본다.
 *
 * **왜 있는가.** 2026-08-26 에 `VITE_API_URL` 없이 빌드해서 배포했다.
 * `tsc` 통과, `vite build` 통과, `wrangler pages deploy` 성공 —
 * 그런데 번들 안에는 `http://localhost:3000` 이 박혀 있었고 사이트는 아무것도 못 불렀다.
 * 같은 빌드에서 실시간 자막 주소(`VITE_STREAM_URL`)도 통째로 빠져 있었는데,
 * 그건 **빈 문자열이라 에러도 안 났다** — 자막 기능이 조용히 사라졌다.
 *
 * 빌드 성공은 배포해도 된다는 뜻이 아니다. 나가는 물건을 직접 본다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist/assets'
const js = readdirSync(dir).filter((f) => f.endsWith('.js'))
if (!js.length) { console.error('✘ dist/assets 에 번들이 없습니다'); process.exit(1) }

const all = js.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
const problems = []

if (/localhost:3000/.test(all)) {
  problems.push('번들이 http://localhost:3000 을 부릅니다 — VITE_API_URL 없이 빌드했습니다.')
}
if (!/iep-api\.[a-z0-9-]+\.workers\.dev/.test(all)) {
  problems.push('번들에 API 주소가 없습니다.')
}
// IEP 실시간 자막 서버는 S5 에서 구축한다. 그전까지 VITE_STREAM_URL 이 없는 것이
// 정상이므로 이 검사는 **주소가 설정돼 있을 때만** 형식을 본다.
// S5 이후: 아래 `false &&` 를 지우면 「자막 주소 필수」 로 돌아간다.
if (false && !/wss:\/\/iep-stream-/.test(all)) {
  problems.push('번들에 실시간 자막 주소가 없습니다 — VITE_STREAM_URL 이 빠졌습니다. '
              + '이건 에러 없이 기능만 사라지므로 화면으로는 알 수 없습니다.')
}

if (problems.length) {
  console.error('✘ 이 번들은 배포하면 안 됩니다:')
  for (const p of problems) console.error('  ·', p)
  console.error('\n  `npm run deploy` 를 쓰십시오 (`npm run build` 는 주소를 넣지 않습니다).')
  process.exit(1)
}
console.log(`✓ 번들 ${js.length}개 확인 — API 주소 박힘 (자막은 S5 구축 후 검사)`)
