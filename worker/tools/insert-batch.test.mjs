#!/usr/bin/env node
/**
 * 묶음 삽입이 **어긋난 문장을 만들지 않는지** 본다.
 *
 * 이 함수의 위험은 느린 것이 아니라 **조용히 틀린 SQL 을 만드는 것**이다.
 * 자리표 번호가 하나만 어긋나도 값이 엉뚱한 열로 들어가고, 그건 오류가 아니라
 * **잘못된 데이터**가 된다.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = join(tmpdir(), 'lep-insert-batch-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'insertBatch.mjs')
await build({
  entryPoints: ['src/services/insertBatch.ts'], outfile: out,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
})
const { insertBatches, BATCH_ROWS } = await import(out)

let fail = 0
const ok = (c, m, d = '') => { console.log(`  ${c ? '✓' : '✘'} ${m}${d ? ` — ${d}` : ''}`); if (!c) fail++ }
const COLS = ['a', 'b', 'c']
const mk = (n) => Array.from({ length: n }, (_, i) => [`m${i}`, i, null])

console.log('── 자리표가 값과 맞는가 ──')
{
  const [[sql, vals]] = insertBatches(mk(3), 't', COLS)
  ok(sql.includes('($1,$2,$3),($4,$5,$6),($7,$8,$9)'), '줄마다 번호가 이어진다', sql.slice(-40))
  ok(vals.length === 9, '값이 3줄 × 3열 = 9개', String(vals.length))
  // **번호와 값의 짝이 맞는지 직접 센다.** 눈으로 보면 틀린 것을 못 본다.
  const nums = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
  ok(nums.length === vals.length, '자리표 개수 = 값 개수')
  ok(nums.every((n, i) => n === i + 1), '자리표가 1부터 빠짐없이 이어진다')
  ok(vals[3] === 'm1' && vals[4] === 1, '두 번째 줄의 값이 제자리에 있다')
}

console.log('\n── 나눠 담기 ──')
{
  const b = insertBatches(mk(1027), 't', COLS, BATCH_ROWS)
  ok(b.length === Math.ceil(1027 / BATCH_ROWS), `1027줄 → ${b.length}문장 (${BATCH_ROWS}줄씩)`)
  const total = b.reduce((n, [, v]) => n + v.length, 0)
  ok(total === 1027 * 3, '한 줄도 빠지지 않는다', `${total} = 1027×3`)
  // **문장마다 번호는 다시 1부터다.** 이어서 매기면 두 번째 문장이 통째로 깨진다.
  ok(b[1][0].startsWith('insert into t (a, b, c) values ($1,$2,$3)'), '두 번째 문장도 $1 부터 시작한다')
  ok(b.every(([, v]) => v.length <= BATCH_ROWS * 3), '한 문장의 값이 상한을 안 넘는다')
  ok(b.every(([, v]) => v.length < 65535), '파라미터 상한(65535) 안쪽이다')
}

console.log('\n── 순서가 지켜지는가 ──')
{
  const b = insertBatches(mk(500), 't', COLS, 200)
  const flat = b.flatMap(([, v]) => v)
  ok(flat[0] === 'm0' && flat[499 * 3] === 'm499', '첫 줄과 마지막 줄이 제자리다')
  // sort_order 를 이 순서로 넣으므로 **뒤섞이면 녹취가 뒤죽박죽이 된다**
  const names = flat.filter((_, i) => i % 3 === 0)
  ok(names.every((v, i) => v === `m${i}`), '500줄이 전부 원래 순서다')
}

console.log('\n── 어긋난 입력은 막는다 ──')
{
  let threw = null
  try { insertBatches([['a', 1, null], ['b', 2]], 't', COLS) } catch (e) { threw = e.message }
  ok(!!threw, '열 수가 다른 줄이 있으면 던진다')
  ok(threw && threw.includes('1번째'), '  몇 번째 줄인지 말한다', threw || '')
  ok(insertBatches([], 't', COLS).length === 0, '빈 입력은 빈 배열 (문장을 만들지 않는다)')
}

console.log(fail ? `\n✘ ${fail}건 실패` : '\n✓ 묶음 삽입 통과 — 자리표와 값이 어긋나지 않는다')
process.exit(fail ? 1 : 0)
