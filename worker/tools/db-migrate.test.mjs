/**
 * 마이그레이션 기록 (027) — **두 번 돌려도 안전한가, 바뀐 파일을 막는가.**
 *
 * 왜 이 시험이 필요한가 (2026-08-26 베타 점검)
 *   기록이 없던 시절에는 이런 질문에 답할 수 없었다 —
 *   같은 것을 두 번 돌렸나, 하나를 건너뛰었나, **적용한 뒤에 파일이 바뀌었나.**
 *
 *   마지막 것이 가장 위험하다. 파일을 고치고 다시 돌리면 `if not exists` 때문에
 *   조용히 아무것도 안 하고 성공한다 — **DB 는 옛 모양인데 저장소는 새 모양**이 되고,
 *   다음 사람은 파일을 보고 DB 가 그렇게 생겼다고 믿는다.
 *
 *   그래서 「거부하는가」를 본다. 통과하는 쪽만 보면 이 보호막이 있는지 알 수 없다.
 *
 * 실행: DATABASE_URL=… node worker/tools/db-migrate.test.mjs
 *   (저장소 어디서 불러도 된다 — 경로를 CWD 에 기대지 않는다)
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MIG = join(ROOT, 'worker', 'tools', 'db-migrate.js')
const NAME = '997'
const FILE = join(ROOT, 'database', `${NAME}_ledger_selftest.sql`)

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 필요합니다.'); process.exit(1)
}

let fails = 0
const ok = (c, m, d = '') => { console.log(`  ${c ? '✓' : '✘'} ${m}${d ? ' — ' + d : ''}`); if (!c) fails++ }

const run = () => spawnSync('node', [MIG, `database/${NAME}_ledger_selftest.sql`],
  { cwd: ROOT, env: process.env, encoding: 'utf8' })

const sqlA = `create table if not exists v2._ledger_selftest (a int);\n`
const sqlB = `create table if not exists v2._ledger_selftest (a int);\n-- 적용 뒤에 덧붙인 줄\n`

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const cleanup = async () => {
  await db.query('drop table if exists v2._ledger_selftest').catch(() => {})
  await db.query('delete from v2.schema_migrations where name = $1', [NAME]).catch(() => {})
  if (existsSync(FILE)) unlinkSync(FILE)
}
await cleanup()

try {
  console.log('\n── 처음 적용 ──')
  writeFileSync(FILE, sqlA)
  let r = run()
  ok(r.status === 0, '적용된다', r.stderr.trim().slice(0, 80))
  let row = (await db.query('select * from v2.schema_migrations where name=$1', [NAME])).rows[0]
  ok(!!row, '기록이 남는다')
  ok(!!row?.checksum, '체크섬이 남는다')
  ok(row?.duration_ms !== null, '걸린 시간이 남는다')
  const tbl = await db.query("select to_regclass('v2._ledger_selftest') as t")
  ok(tbl.rows[0].t !== null, '실제로 표가 만들어졌다')

  console.log('\n── 같은 파일을 다시 ──')
  r = run()
  ok(r.status === 0, '실패하지 않는다')
  ok(/건너뜀/.test(r.stdout), '건너뛴다고 말한다', r.stdout.trim().split('\n').pop())
  const n = (await db.query('select count(*)::int n from v2.schema_migrations where name=$1', [NAME])).rows[0].n
  ok(n === 1, '기록이 두 줄로 늘지 않는다', `${n}줄`)

  console.log('\n── **적용한 뒤에 파일이 바뀌었다** ──')
  writeFileSync(FILE, sqlB)
  r = run()
  ok(r.status !== 0, '거부한다 (이게 이 기능의 존재 이유다)', `exit ${r.status}`)
  ok(/파일이 그 뒤에 바뀌었/.test(r.stderr), '무엇이 문제인지 말한다')
  ok(/새 번호의 마이그레이션/.test(r.stderr), '무엇을 해야 하는지 말한다')

  console.log('\n── 소급분(체크섬 없음)은 비교하지 않는다 ──')
  await db.query('update v2.schema_migrations set checksum = null, note = $2 where name = $1',
    [NAME, '소급분 흉내'])
  r = run()
  ok(r.status === 0, '거부하지 않는다 — 적용 당시 파일을 모르므로 다르다고 말할 근거가 없다')
  ok(/건너뜀/.test(r.stdout), '건너뛴다고 말한다')
} finally {
  await cleanup()
  await db.end()
}

console.log(fails ? `\n✘ ${fails}건 실패` : '\n✓ 마이그레이션 기록 통과 — 두 번 돌려도 안전하고, 바뀐 파일은 막는다')
process.exit(fails ? 1 : 0)
