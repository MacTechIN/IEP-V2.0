#!/usr/bin/env node
/**
 * 로그인 비밀번호를 DB 에서 직접 바꾼다.
 *
 * ## 언제 쓰나
 *
 * **관리자가 로그인을 못 할 때뿐이다.** 화면으로 바꿀 수 있으면 그쪽을 쓴다 —
 * 이 도구는 화면에 못 들어가는 상황을 푸는 마지막 수단이다.
 * (2026-08-28: `admin@company.com` 이 SEP 에 로그인을 못 했다 — SEP 에서 먼저 만들어 옮겼다.)
 *
 * ## 값을 보지 않는다
 *
 * 비밀번호도 접속 주소도 **입력이 화면에 안 보이고**, 출력에도 안 나온다.
 * 대화나 로그에 남기지 않으려고 이렇게 만들었다.
 *
 * ## 바꾸기 전에 보여 준다
 *
 * 어느 계정을 · 활성 상태인지 · 언제 마지막으로 바뀌었는지 먼저 적고,
 * **이메일을 손으로 적어야** 바꾼다. 목록에서 한 줄 잘못 고르는 것을 막는다.
 *
 * ## 잠금도 함께 푼다
 *
 * 비밀번호를 바꿔 놓고 `429` 로 못 들어가면 「아직도 안 된다」 가 된다 (013).
 *
 * 실행: node worker/tools/reset-password.mjs
 */
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const MIN = 6   // src/lib/auth.ts 의 MIN_PASSWORD_LENGTH 와 같아야 한다 (LEP 은 6, SEP 는 9)

/**
 * 입력을 받는다.
 *
 * **사람이 치면 가려서 받고, 파이프로 들어오면 그대로 읽는다.**
 * 가리기만 하면 이 도구를 **시험할 방법이 없다** — 2026-08-28 에 그래서
 * 검증이 멈췄다. 시험할 수 없는 도구는 「돌 것 같다」 로 남는다.
 */
const lines = []
if (!stdin.isTTY) {
  const chunks = []
  for await (const c of stdin) chunks.push(c)
  lines.push(...Buffer.concat(chunks).toString('utf8').split('\n'))
}
let li = 0
const readLine = () => (li < lines.length ? lines[li++].replace(/\r$/, '') : '')

function hidden(prompt) {
  if (!stdin.isTTY) return Promise.resolve(readLine())
  return new Promise((res) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })
    stdout.write(prompt)
    rl._writeToOutput = () => {}
    rl.question('', (a) => { stdout.write('\n'); rl.close(); res(a) })
  })
}
const ask = (prompt) => {
  if (!stdin.isTTY) return Promise.resolve(readLine().trim())
  return new Promise((res) => {
    const rl = createInterface({ input: stdin, output: stdout })
    rl.question(prompt, (a) => { rl.close(); res(a.trim()) })
  })
}

const url = (await hidden('DATABASE_URL 붙여넣고 Enter: ')).trim()
if (!url.startsWith('postgres')) { console.error('✘ 접속 주소가 아닙니다'); process.exit(1) }
/**
 * `sslrootcert=system` 은 **psql 전용**이다. node 는 그 값을 파일 경로로 읽어
 * `ENOENT: open 'system'` 으로 죽는다 (2026-08-28 에 실제로 그랬다).
 * node 는 기본 CA 로 Neon 인증서를 검증하므로 떼어 내면 그대로 붙는다.
 */
const conn = url.replace(/[?&]sslrootcert=[^&]*/g, (m) => (m[0] === '?' ? '?' : ''))
  .replace(/\?&/, '?').replace(/[?&]$/, '')

const c = new pg.Client({ connectionString: conn })
try { await c.connect() } catch (e) {
  console.error('✘ DB 에 못 붙었습니다 —', String(e.message).slice(0, 120)); process.exit(1)
}

try {
  const list = await c.query(
    `select email, is_active, role, updated_at from v2.users order by created_at`)
  if (!list.rowCount) { console.error('✘ 계정이 하나도 없습니다'); process.exit(1) }
  console.log('\n계정 목록')
  for (const u of list.rows) {
    console.log(`  ${u.email.padEnd(28)} 활성=${u.is_active}  역할=${u.role}`
      + `  마지막 변경 ${new Date(u.updated_at).toISOString().slice(0, 16).replace('T', ' ')}`)
  }

  const email = (await ask('\n바꿀 계정의 이메일을 그대로 적으십시오: ')).toLowerCase()
  const target = list.rows.find((u) => u.email.toLowerCase() === email)
  if (!target) { console.error('✘ 그런 계정이 없습니다 — 바꾸지 않았습니다'); process.exit(1) }
  if (!target.is_active) {
    // **비밀번호만 바꿔서는 안 들어가진다.** 로그인 질의가 `is_active = true` 를 본다.
    console.log('\n⚠ 이 계정은 **비활성** 입니다. 비밀번호를 바꿔도 로그인되지 않습니다.')
    const on = (await ask('  함께 활성으로 되돌릴까요? (yes/no): ')).toLowerCase()
    if (on !== 'yes') { console.error('✘ 그만둡니다'); process.exit(1) }
    target.reactivate = true
  }

  const pw = await hidden(`\n새 비밀번호 (${MIN}자 이상, 화면에 안 보입니다): `)
  if (pw.length < MIN) { console.error(`✘ ${MIN}자 이상이어야 합니다 — 바꾸지 않았습니다`); process.exit(1) }
  const again = await hidden('한 번 더: ')
  if (pw !== again) { console.error('✘ 두 값이 다릅니다 — 바꾸지 않았습니다'); process.exit(1) }

  const hash = bcrypt.hashSync(pw, 10)
  await c.query('begin')
  const r = await c.query(
    `update v2.users set password_hash = $2, is_active = true, updated_at = now()
      where lower(email) = $1`, [email, hash])
  // **잠금도 푼다.** 바꿔 놓고 429 로 못 들어가면 「아직도 안 된다」 가 된다 (013).
  const t = await c.query('delete from v2.login_throttle').catch(() => ({ rowCount: 0 }))
  // 열려 있던 세션은 끊는다 — 비밀번호를 바꾼 이유가 유출이면 그게 핵심이다.
  const s = await c.query(
    `update v2.sessions set is_active = false, revoked_at = now()
      where user_id = (select id from v2.users where lower(email) = $1) and is_active = true`,
    [email]).catch(() => ({ rowCount: 0 }))
  await c.query('commit')

  console.log(`\n✓ ${email} 의 비밀번호를 바꿨습니다`)
  console.log(`  계정 ${r.rowCount}개 · 잠금 기록 ${t.rowCount ?? 0}개 지움 · 세션 ${s.rowCount ?? 0}개 끊음`)
  console.log('  이제 화면에서 새 비밀번호로 들어가십시오.')
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error('✘ 실패 —', String(e.message).slice(0, 160))
  process.exitCode = 1
} finally { await c.end() }
