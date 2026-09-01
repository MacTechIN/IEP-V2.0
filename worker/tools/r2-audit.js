#!/usr/bin/env node
/**
 * R2 객체와 DB 참조를 대조한다. **읽기만 한다 — 아무것도 지우지 않는다.**
 *
 * 왜 필요한가
 *   업로드는 R2 와 DB 를 따로 쓴다. 둘 사이가 끊기면 한쪽만 남고, 어느 쪽이든
 *   화면에서는 보이지 않는다. 2026-08-11 에 잃은 줄 알았던 녹음 4개(40분 15초)가
 *   R2 에 그대로 있었는데, **그 사실을 알아내는 방법이 없어서** 잃은 줄 알았다.
 *
 *   전사를 Workflow 로 빼면서 그 구간은 count 한 번과 insert 한 번으로 줄었지만(010),
 *   `POST /meetings/:id/audio` 는 아직 R2 를 먼저 쓰고 DB 를 나중에 쓴다.
 *   구간이 좁아진 것이지 없어진 것이 아니므로, 대조할 수단은 계속 있어야 한다.
 *
 * 두 방향을 모두 본다
 *   - **고아**    R2 에 있는데 DB 가 안 가리킨다 → 화면에 안 보이는 파일
 *   - **끊긴 참조** DB 는 가리키는데 R2 에 없다 → 재생·재분석이 안 되는 행
 *
 * 실행
 *   DATABASE_URL=… CLOUDFLARE_API_TOKEN=… CF_ACCOUNT_ID=… node tools/r2-audit.js
 *
 *   DATABASE_URL 은 로컬에 없다. Actions 의 DB 워크플로에서 `audit` 으로 돌리는 것이 정식 경로다
 *   (.github/workflows/db.yml). 사내 서버에 들어갈 필요가 없다.
 */
import pg from 'pg'
const { Client } = pg

const BUCKET = process.env.R2_BUCKET || 'iep-uploads'
const TOKEN = process.env.CLOUDFLARE_API_TOKEN
const ACCOUNT = process.env.CF_ACCOUNT_ID

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

async function listR2() {
  if (!TOKEN || !ACCOUNT) throw new Error('CLOUDFLARE_API_TOKEN 과 CF_ACCOUNT_ID 가 필요합니다')
  const out = []
  let cursor = ''
  // 한 번에 1000개씩. 커서가 없어질 때까지 돈다 — 잘라 읽으면 있는 파일을 고아로 오판한다.
  for (;;) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`
      + `/r2/buckets/${BUCKET}/objects?per_page=1000${cursor ? `&cursor=${cursor}` : ''}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const d = await res.json()
    if (!d.success) throw new Error('R2 조회 실패: ' + JSON.stringify(d.errors).slice(0, 300))
    out.push(...(d.result || []))
    cursor = d.result_info?.cursor
    if (!cursor) return out
  }
}

/** R2 키를 담는 곳은 셋이다. 하나라도 빠뜨리면 멀쩡한 파일이 고아로 잡힌다. */
async function dbRefs(db) {
  const ref = new Map()
  const add = (key, what) => {
    if (!key || key.startsWith('/')) return   // 옛 사내 서버의 로컬 경로는 R2 키가 아니다
    if (!ref.has(key)) ref.set(key, [])
    ref.get(key).push(what)
  }
  for (const r of (await db.query(
    `select storage_path, label, meeting_id, transcribe_status
       from v2.meeting_recordings where storage_path is not null`)).rows) {
    add(r.storage_path, `녹음 "${r.label}" (${r.meeting_id ? '미팅 연결' : 'draft'}, 전사 ${r.transcribe_status})`)
  }
  for (const r of (await db.query(
    `select audio_url, title, deleted_at from v2.meetings where audio_url is not null`)).rows) {
    add(r.audio_url, `미팅 오디오 "${r.title}"${r.deleted_at ? ' (삭제됨)' : ''}`)
  }
  for (const r of (await db.query(
    `select voice_ref->>'storage_path' as p, email from v2.users
      where voice_ref->>'storage_path' is not null`)).rows) {
    add(r.p, `목소리 등록 ${r.email}`)
  }
  return ref
}

;(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const [objs, ref] = await Promise.all([listR2(), dbRefs(db)])
  await db.end()

  const byKey = new Map(objs.map((o) => [o.key, o]))
  const orphans = [...byKey.keys()].filter((k) => !ref.has(k))
  const dangling = [...ref.keys()].filter((k) => !byKey.has(k))

  console.log(`R2 객체 ${byKey.size}개 · DB 참조 ${ref.size}개\n`)

  console.log(`── 고아 (R2 에 있는데 DB 가 안 가리킴): ${orphans.length}개`)
  let total = 0
  for (const k of orphans.sort((a, b) => byKey.get(b).size - byKey.get(a).size)) {
    const o = byKey.get(k)
    total += o.size
    console.log(`   ${mb(o.size).padStart(8)}  ${(o.uploaded || '').slice(0, 19)}  ${k}`)
  }
  if (orphans.length) console.log(`   합계 ${mb(total)}`)

  console.log(`\n── 끊긴 참조 (DB 는 가리키는데 R2 에 없음): ${dangling.length}개`)
  for (const k of dangling.sort()) {
    for (const what of ref.get(k)) console.log(`   ${what}\n      ${k}`)
  }

  // **판단은 사람이 한다.** 고아라고 전부 쓰레기가 아니다 —
  // 2026-08-11 의 4개는 회수해 보관하기로 한 원본이라 지우면 안 된다.
  console.log('\n지우지 않았습니다. 목록만 보여 줍니다.')
  process.exit(0)
})().catch((e) => { console.error('실패:', e.message); process.exit(1) })
