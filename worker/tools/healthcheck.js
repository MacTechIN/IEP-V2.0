#!/usr/bin/env node
/**
 * 서비스가 지금 쓸 만한 상태인가. **읽기만 한다.**
 *
 * 왜 필요한가
 *   다른 사람들이 테스트하는 동안 무언가 조용히 망가지면, 그 사람이 알려 주기 전까지
 *   아무도 모른다. 그리고 알려 줄 때쯤이면 **언제부터 그랬는지**를 알 수 없다.
 *   한 시간에 한 줄씩 남겨 두면 "어제 저녁부터" 를 말할 수 있다.
 *
 * 무엇을 재나 — **살아 있는지만 보지 않는다.**
 *   HTTP 200 은 "죽지 않았다" 는 뜻일 뿐이다. 쓸 만한지는 다르다:
 *     · 화면이 **지금 번들**을 주는가 (배포가 반쯤 걸린 상태를 잡는다)
 *     · 로그인이 되는가 (토큰 발급까지)
 *     · DB 가 응답하는가, 얼마나 걸리는가
 *     · **전사가 밀려 있지 않은가** — 쌓이면 Workflow 가 안 도는 것이다
 *     · 실패한 분석이 늘고 있지 않은가
 *
 * 실행
 *   HEALTH_EMAIL=… HEALTH_PASSWORD=… node worker/tools/healthcheck.js
 *   DATABASE_URL 이 있으면 DB 검사까지 한다(없으면 건너뛴다 — 그것도 결과에 적는다).
 */
import pg from 'pg'

/**
 * **감시 대상은 LEP 이다.**
 *
 * 포크할 때 기본값이 `sep-v2-*` 인 채로 넘어왔다. 2026-08-26 에 켜기 직전에 잡았다 —
 * 그대로 켰으면 **LEP 이 죽어도 초록불이고 SEP 만 보고 있었다.**
 * 「감시하고 있다」는 믿음만 주고 실제로는 아무것도 안 보는 것이 안 켠 것보다 나쁘다.
 *
 * 환경변수로 덮을 수 있게 둔 것은 그대로다 — 대상이 늘면 그때 쓴다.
 */
const WEB = process.env.HEALTH_WEB || 'https://iep-web.pages.dev'
const API = process.env.HEALTH_API || 'https://iep-api.wooriszhome.workers.dev'
const STREAM = process.env.HEALTH_STREAM
  || '' // IEP 스트림 미구축(S5). 빈 값이면 스트림 검사 건너뜀

/** 느려지는 것도 고장이다. 이 값을 넘으면 경고로 본다. */
const SLOW_MS = 3000

const checks = []
const add = (name, ok, detail, ms) => checks.push({ name, ok, detail, ms })
/**
 * 검사하지 **못한** 것. 통과와 절대 같은 글자로 적지 않는다 —
 * 계정이 없어 건너뛴 로그인이 `login=ok` 로 남으면, 로그는 확인한 적 없는 것을
 * 확인했다고 말하게 된다. 감시가 거짓말을 하면 없느니만 못하다.
 */
const skip = (name, why) => checks.push({ name, ok: true, skipped: true, detail: why, ms: 0 })

async function timed(fn) {
  const t = Date.now()
  try { return { r: await fn(), ms: Date.now() - t } }
  catch (e) { return { err: e instanceof Error ? e.message : String(e), ms: Date.now() - t } }
}

async function main() {
  // ── 화면
  {
    const { r, err, ms } = await timed(() => fetch(`${WEB}/?hc=${Date.now()}`))
    if (err) add('web', false, err, ms)
    else {
      const html = await r.text()
      const bundle = html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0]
      // 번들 이름이 안 잡히면 index.html 이 아니라 오류 페이지를 받은 것이다.
      add('web', r.ok && !!bundle, bundle || `HTTP ${r.status} · 번들 없음`, ms)
    }
  }

  // ── API
  {
    const { r, err, ms } = await timed(() => fetch(`${API}/health`))
    add('api', !err && r?.ok, err || `HTTP ${r?.status}`, ms)
  }

  // ── 실시간 자막 게이트웨이
  {
    const { r, err, ms } = await timed(() => fetch(`${STREAM}/health`))
    // Cloud Run 은 안 쓰면 인스턴스를 0으로 내린다 — 첫 요청이 느린 것은 정상이다.
    add('stream', !err && r?.ok, err || `HTTP ${r?.status}`, ms)
  }

  // ── 인증 경로
  //
  // **계정 없이도 대부분을 본다.** 없는 계정으로 로그인을 시도해서 401 이 오는지 본다.
  // 그것만으로 확인되는 것: 인증 라우트가 살아 있고, DB 까지 닿고, 거부가 동작한다.
  // 이 셋이 인증 사고의 대부분이다.
  //
  // 확인되지 **않는** 것: 맞는 비밀번호로 토큰이 실제로 발급되는가.
  // JWT 서명 키가 잘못되면 여기는 통과하고 사용자는 못 들어온다.
  // 그것까지 보려면 진짜 계정이 필요한데, 하루 24번 로그인할 계정을 만들고
  // 비밀번호를 CI 에 두는 값이 그 하나에 값하는지는 따로 판단할 일이다.
  // HEALTH_EMAIL·HEALTH_PASSWORD 가 있으면 그쪽으로 확인한다.
  const email = process.env.HEALTH_EMAIL
  const password = process.env.HEALTH_PASSWORD
  if (email && password) {
    const { r, err, ms } = await timed(() => fetch(`${API}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }))
    if (err) add('login', false, err, ms)
    else {
      const d = await r.json().catch(() => null)
      add('login', !!d?.data?.accessToken, d?.data?.accessToken ? '토큰 발급됨' : `HTTP ${r.status}`, ms)
    }
  } else {
    // 아무 데이터도 만들지 않고 아무것도 바꾸지 않는다. 잠금·횟수제한이 없는 것은
    // 2026-08-15 에 확인했다 — 이 시도가 무언가를 잠그지 않는다.
    const { r, err, ms } = await timed(() => fetch(`${API}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'healthcheck-probe@invalid.local',
        password: 'this-account-does-not-exist',
      }),
    }))
    if (err) add('auth', false, err, ms)
    // 429 도 정상이다 — 013 의 시도 제한이 걸린 것이고, 그것도 거부다.
    // 이 탐침 자체가 매시간 실패 로그인이라, 이걸 실패로 보면 우리가 만든 방어에
    // 우리가 걸려 경보가 울린다.
    else if (r.status === 401 || r.status === 429) {
      add('auth', true, `${r.status} (거부 동작)`, ms)
    }
    // **200 이면 장애가 아니라 사고다.** 아무 비밀번호나 통과한다는 뜻이다.
    else if (r.status === 200) add('auth', false, '**아무 비밀번호나 통과** — 즉시 확인', ms)
    else add('auth', false, `HTTP ${r.status}`, ms)
  }

  // ── DB
  if (process.env.DATABASE_URL) {
    /**
     * **`sslmode=require` 를 그대로 쓰지 않는다.**
     *
     * pg 8 이 `require` 를 만나면 stderr 로 긴 경고를 뱉는다. 그 경고가 CI 로그
     * 맨 앞에 붙어 **커밋 제목이 「SECURITY」 가 됐다** — 실제 상태는 `SLOW` 였다
     * (2026-08-26 첫 실행에서 실측). 상태 한 글자를 못 믿게 되면 기록 전체가 못 쓴다.
     *
     * `uselibpqcompat` 을 붙이면 경고 없이 같은 동작을 한다.
     */
    const url = (process.env.DATABASE_URL || '').includes('uselibpqcompat')
      ? process.env.DATABASE_URL
      : String(process.env.DATABASE_URL || '').replace(
          /([?&])sslmode=require/, '$1uselibpqcompat=true&sslmode=require')
    const c = new pg.Client({ connectionString: url })
    const { r, err, ms } = await timed(async () => {
      await c.connect()
      // 한 번에 묻는다. 연결을 여러 번 여는 것 자체가 지연이고, 그러면 ms 가 무의미해진다.
      const q = await c.query(`select
        (select count(*)::int from v2.meeting_recordings
          where transcribe_status in ('pending','processing')
            and created_at < now() - interval '30 minutes') as stuck,
        (select count(*)::int from v2.meetings
          where analysis_status = 'failed' and created_at > now() - interval '24 hours') as failed,
        (select count(*)::int from v2.meetings
          where created_at > now() - interval '24 hours') as recent`)
      return q.rows[0]
    })
    await c.end().catch(() => {})

    if (err) {
      add('db', false, err.slice(0, 80), ms)
    } else {
      add('db', true, 'ok', ms)
      // **밀린 전사는 실패로 본다.** 서비스는 살아 있지만 사용자는 결과를 못 받는다 —
      // 화면은 "전사 중" 만 보여줘서, 이 숫자를 안 보면 며칠이 지나도 모른다.
      add('transcribe', r.stuck === 0, r.stuck ? `밀림 ${r.stuck}건` : 'ok', 0)
      // 실패는 세기만 한다. 오디오가 무음이어도 실패로 잡히므로 그 자체가 고장은 아니다.
      add('analysis', true, `24h 미팅 ${r.recent} · 실패 ${r.failed}`, 0)
    }
  } else {
    skip('db', 'DATABASE_URL 없음')
    skip('transcribe', 'DB 없이는 볼 수 없다')
    skip('analysis', 'DB 없이는 볼 수 없다')
  }

  // ── 한 줄로 남긴다. 기계도 읽고 사람도 읽을 수 있어야 한다.
  const bad = checks.filter((c) => !c.ok)
  const slow = checks.filter((c) => c.ok && c.ms > SLOW_MS)
  const skipped = checks.filter((c) => c.skipped)
  // 건너뛴 항목이 있으면 'OK' 라고 하지 않는다. 다 봤다는 뜻이 되어 버린다.
  const status = bad.length ? 'DOWN' : slow.length ? 'SLOW' : skipped.length ? 'PART' : 'OK'
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const parts = checks.map((c) => {
    if (!c.ok) return `${c.name}=FAIL`
    if (c.skipped) return `${c.name}=skip`
    return `${c.name}=${c.ms ? `${c.ms}ms` : 'ok'}`
  })

  console.log(`${stamp}  ${status.padEnd(4)}  ${parts.join(' ')}`)
  if (bad.length) console.log(`  실패: ${bad.map((c) => `${c.name}(${c.detail})`).join(' · ')}`)
  if (slow.length) console.log(`  느림: ${slow.map((c) => `${c.name} ${c.ms}ms`).join(' · ')}`)
  if (skipped.length) console.log(`  못 봄: ${skipped.map((c) => `${c.name}(${c.detail})`).join(' · ')}`)
  for (const c of checks) {
    if (c.skipped) continue
    if (c.name === 'analysis' || (c.name === 'web' && c.ok)) console.log(`  ${c.name}: ${c.detail}`)
  }

  // 실패하면 종료 코드로 알린다 — Actions 가 이걸로 알림을 보낸다.
  process.exit(bad.length ? 1 : 0)
}

main().catch((e) => { console.error('점검 자체가 실패:', e.message); process.exit(2) })
