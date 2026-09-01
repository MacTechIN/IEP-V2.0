#!/usr/bin/env node
/**
 * DB 가 지금 어떤 상태인지 한 화면에 보여 준다. **읽기만 한다.**
 *
 * 마이그레이션을 적용하기 전후로 이걸 돌려 무엇이 바뀌었는지 확인한다.
 * 사내 컨테이너에 들어가지 않고도 볼 수 있어야 한다는 것이 요점이다.
 *
 *   DATABASE_URL=… node worker/tools/db-status.js
 */
import pg from 'pg'
const { Client } = pg

const TABLES = [
  'users', 'customers', 'meetings', 'meeting_recordings',
  'analysis_results', 'transcript_segments', 'action_items',
]

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  const host = (await c.query('select current_database() as db, version() as v')).rows[0]
  console.log(`DB: ${host.db}  ·  ${String(host.v).split(',')[0]}\n`)

  console.log('행 수')
  for (const t of TABLES) {
    try {
      const n = (await c.query(`select count(*)::int as n from v2.${t}`)).rows[0].n
      console.log(`  ${t.padEnd(22)} ${String(n).padStart(6)}`)
    } catch {
      console.log(`  ${t.padEnd(22)} ${'(없음)'.padStart(6)}`)
    }
  }

  // 어떤 마이그레이션까지 반영됐는지 — 버전 테이블이 없으므로 **컬럼의 존재로 판정한다.**
  // 번호를 적어 두는 표를 새로 만들면 그 표 자체가 또 어긋난다.
  console.log('\n스키마 표식')
  const marks = [
    ['007 action_items_done', "select 1 from information_schema.columns where table_schema='v2' and table_name='analysis_results' and column_name='action_items_done'"],
    ['008 voice_ref', "select 1 from information_schema.columns where table_schema='v2' and table_name='users' and column_name='voice_ref'"],
    ['009 meeting_note', "select 1 from information_schema.columns where table_schema='v2' and table_name='analysis_results' and column_name='meeting_note'"],
    ['010 transcribe_status', "select 1 from information_schema.columns where table_schema='v2' and table_name='meeting_recordings' and column_name='transcribe_status'"],
  ]
  for (const [label, q] of marks) {
    const hit = (await c.query(q)).rowCount > 0
    console.log(`  ${hit ? '✓' : '✗'} ${label}`)
  }

  // 전사가 밀려 있는지. 010 이후로 이게 쌓이면 Workflow 가 안 돌고 있다는 뜻이다.
  try {
    const r = await c.query(
      `select transcribe_status, count(*)::int as n
         from v2.meeting_recordings group by 1 order by 1`)
    console.log('\n전사 상태')
    for (const row of r.rows) console.log(`  ${row.transcribe_status.padEnd(12)} ${row.n}`)
    const stuck = await c.query(
      `select count(*)::int as n from v2.meeting_recordings
        where transcribe_status = 'processing'
          and transcribe_started_at < now() - interval '20 minutes'`)
    if (stuck.rows[0].n > 0) {
      console.log(`  ⚠ 20분 넘게 processing 인 행 ${stuck.rows[0].n}개 — 다음 분석 때 회수됩니다`)
    }
  } catch { /* 010 이전이면 컬럼이 없다 */ }

  await c.end()
})().catch((e) => { console.error('실패:', e.message); process.exit(1) })
