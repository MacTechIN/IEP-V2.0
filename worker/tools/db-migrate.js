#!/usr/bin/env node
/**
 * .sql 파일 하나를 적용하고 **적용했다는 사실을 같은 트랜잭션에 남긴다.**
 *
 *   DATABASE_URL=… node worker/tools/db-migrate.js database/010_recording_transcribe_state.sql
 *
 * **한 트랜잭션으로 돌린다.** 마이그레이션이 중간에 실패했는데 앞부분만 남으면,
 * 다시 돌릴 수도 없고 되돌릴 수도 없는 상태가 된다 — 그때부터는 사람이 손으로 맞춰야 한다.
 * (Postgres 는 DDL 도 트랜잭션 안에서 되돌릴 수 있다. 이 점에서 운이 좋은 편이다.)
 *
 * ── 기록을 왜 같은 트랜잭션에 넣나 (027) ──
 *
 * 따로 넣으면 **둘이 어긋난다.** 마이그레이션은 성공했는데 기록이 실패하면
 * 다음 실행이 같은 것을 또 돌리고, 반대면 안 돌린 것을 돌렸다고 믿는다.
 * 한 트랜잭션에 넣으면 **둘 다 되거나 둘 다 안 된다.**
 *
 * ── 세 가지로 갈린다 ──
 *
 *   기록에 없다              → 적용하고 기록한다
 *   기록에 있고 체크섬이 같다  → **건너뛴다.** 두 번 돌려도 안전하다
 *   기록에 있는데 체크섬이 다르다 → **거부한다.** 적용한 뒤에 파일이 바뀐 것이다.
 *                              `if not exists` 때문에 다시 돌리면 조용히 성공하고,
 *                              DB 는 옛 모양인데 저장소는 새 모양이 된다
 *
 * 체크섬이 `null` 인 것(027 이전 소급분)은 **비교하지 않고 건너뛴다** —
 * 적용 당시의 파일을 모르므로 다르다고 말할 근거가 없다.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import pg from 'pg'
const { Client } = pg

const file = process.argv[2]
if (!file) { console.error('사용법: node db-migrate.js <파일.sql>'); process.exit(1) }

// 저장소 밖의 파일을 읽지 않는다. CI 입력으로 경로가 들어오므로 확인한다.
const abs = path.resolve(file)
if (!abs.startsWith(path.resolve('database') + path.sep)) {
  console.error(`중단: database/ 안의 파일만 적용합니다 — ${file}`)
  process.exit(1)
}
if (!fs.existsSync(abs)) { console.error(`파일이 없습니다: ${file}`); process.exit(1) }

const sql = fs.readFileSync(abs, 'utf8')
const base = path.basename(abs)
/** `023_delete_user.sql` → `023`. 이름이 바뀌어도 같은 마이그레이션으로 본다. */
const name = base.match(/^(\d+)/)?.[1] ?? base.replace(/\.sql$/, '')
const checksum = crypto.createHash('sha256').update(sql).digest('hex')

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    // 기록표 자체가 아직 없을 수 있다 (027 을 적용하는 그 순간). 그때는 없는 대로 진행한다.
    let prior = null
    let hasLedger = true
    try {
      const r = await c.query(
        'select name, checksum, applied_at, note from v2.schema_migrations where name = $1', [name])
      prior = r.rows[0] ?? null
    } catch {
      hasLedger = false
    }

    if (prior) {
      if (prior.checksum === null) {
        console.log(`건너뜀: ${base} — 이미 적용됨 (체크섬 없음: ${prior.note ?? '027 이전 소급분'})`)
        return
      }
      if (prior.checksum === checksum) {
        console.log(`건너뜀: ${base} — 이미 적용됨 (${prior.applied_at.toISOString?.() ?? prior.applied_at}), 내용도 그대로`)
        return
      }
      console.error(`중단: ${base} 는 이미 적용됐는데 **파일이 그 뒤에 바뀌었습니다.**`)
      console.error(`  적용 당시 ${prior.checksum.slice(0, 12)}…  지금 ${checksum.slice(0, 12)}…`)
      console.error('  다시 돌리면 `if not exists` 때문에 조용히 성공하고, DB 는 옛 모양으로 남습니다.')
      console.error('  바뀐 부분을 **새 번호의 마이그레이션**으로 내십시오.')
      process.exit(1)
    }

    console.log(`적용: ${base} (${sql.length}자, sha256 ${checksum.slice(0, 12)}…)`)
    const started = Date.now()
    await c.query('begin')
    await c.query(sql)
    // **적용과 같은 트랜잭션이다.** 둘이 어긋날 수 없다.
    // 027 자신을 적용하는 중이라면 이 시점에는 표가 생겨 있다.
    await c.query(
      `insert into v2.schema_migrations (name, checksum, applied_by, duration_ms)
       values ($1,$2,$3,$4)
       on conflict (name) do update
         set checksum = excluded.checksum, applied_at = now(),
             applied_by = excluded.applied_by, duration_ms = excluded.duration_ms,
             note = null`,
      [name, checksum, process.env.GITHUB_ACTOR || os.userInfo().username, Date.now() - started])
    await c.query('commit')
    console.log(`완료 — 커밋됨 (${Date.now() - started}ms)${hasLedger ? '' : ' · 기록표를 이번에 만들었습니다'}`)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error('실패 — 되돌렸습니다. 아무것도 바뀌지 않았습니다.')
    console.error(`  ${e.message}`)
    process.exit(1)
  } finally {
    await c.end()
  }
})().catch((e) => { console.error('실패:', e.message); process.exit(1) })
