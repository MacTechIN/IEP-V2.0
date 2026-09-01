// SEP v2 API — Cloudflare Worker (Phase C)
//
// 진행 상황
//   C-1 ✅ 뼈대 + Hyperdrive
//   C-2 ✅ 미들웨어 4개 + 인증 라우트
//   C-3 ✅ customers · users · actions
//   C-4a ✅ 미팅 읽기 · dashboard · analytics
//   C-4b~ 업로드(R2)·분석. 그때까지 사내 Express 백엔드가 계속 처리한다.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env, Vars } from './lib/env'
import { connectionString, withDb } from './lib/db'
import { fail, requestLogger, requireAdmin, requireAuth } from './middleware'
import authRoutes from './routes/auth'
import resourceRoutes from './routes/resources'
import meetingRoutes from './routes/meetings'
import matterRoutes from './routes/matters'
import documentRoutes from './routes/documents'
import imageRoutes from './routes/images'
import { AnalysisWorkflow } from './workflows/analysis'
import { TranscribeWorkflow } from './workflows/transcribe'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

app.use('*', requestLogger)

// SPA 가 Pages(다른 오리진)에서 오므로 CORS 가 필요하다.
// **와일드카드를 쓰지 않는다.** 허용할 오리진을 명시하고, 목록에 없으면 헤더를 주지 않는다.
// 인증은 Authorization 헤더로 하므로 credentials 는 필요 없다 — 쿠키를 쓰지 않는다.
app.use('/api/*', cors({
  origin: (origin, c) => {
    const allowed = (c.env.ALLOWED_ORIGINS || '').split(',')
      .map((o: string) => o.trim()).filter(Boolean)
    return allowed.includes(origin) ? origin : undefined
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}))

// 공개. 살아 있는지만 알린다 — 버전도 구성도 노출하지 않는다.
app.get('/health', (c) => c.json({ ok: true }))

// 실시간 전사는 Cloud Run 의 stream-service 가 맡는다. 여기에는 경로가 없다.

app.route('/api/v2/auth', authRoutes)

// C-3 이관분. 전부 인증이 필요하다.
app.use('/api/v2/customers/*', requireAuth)
app.use('/api/v2/customers', requireAuth)
app.use('/api/v2/users/*', requireAuth)
app.use('/api/v2/actions/*', requireAuth)
app.use('/api/v2/actions', requireAuth)
// 관리자 경로도 먼저 인증을 통과해야 한다. 이게 없으면 `c.get('user')` 가 비어
// requireAdmin 이 항상 403 을 낸다 — 막히긴 하지만 관리자도 못 쓴다.
app.use('/api/v2/admin/*', requireAuth)
app.route('/api/v2', resourceRoutes)

// C-4a 이관분 — 미팅 읽기 · 대시보드 · 분석 통계
app.use('/api/v2/meetings', requireAuth)
app.use('/api/v2/meetings/*', requireAuth)
app.use('/api/v2/dashboard/*', requireAuth)
app.use('/api/v2/analytics/*', requireAuth)
app.use('/api/v2/analysis/*', requireAuth)
app.use('/api/v2/risk', requireAuth)
// 코칭 판정 기록·피드백·타임라인 (015). **이게 없으면 `c.get('user')` 가 비어 터진다.**
app.use('/api/v2/coaching/*', requireAuth)
// 법률 분해 결과 (018). **게이트가 없으면 `c.get('user')` 가 비어 터진다.**
app.use('/api/v2/legal/*', requireAuth)
// 사건·기한 (016~022). **전부 담당자만** — 관리자 우회가 없다.
app.use('/api/v2/matters', requireAuth)
app.use('/api/v2/matters/*', requireAuth)
app.use('/api/v2/deadlines', requireAuth)
app.use('/api/v2/deadlines/*', requireAuth)
// 요건사실 (025). **이것도 게이트가 필요하다** — 2026-08-26 에 빠뜨려 PATCH 가 전부 500 이었다.
// SQL 은 멀쩡한데 `c.get('user')` 가 비어 터진 것이라, 원인이 DB 처럼 보인다.
app.use('/api/v2/elements/*', requireAuth)
// 서면 (029). **사건과 같은 규칙** — 담당자만. 게이트를 빠뜨리면 c.get('user') 가 비어 터진다.
app.use('/api/v2/documents', requireAuth)
app.use('/api/v2/documents/*', requireAuth)
app.use('/api/v2/images', requireAuth)
app.use('/api/v2/images/*', requireAuth)
app.use('/api/v2/recordings', requireAuth)
// 오디오 재생만 예외다 (012). `<audio src>` 는 헤더를 붙일 수 없어 티켓을 쿼리로 받는다.
// **여기서 통과시켜도 라우트가 티켓을 검증한다** — 티켓이 없으면 그쪽에서 401 을 준다.
// 티켓은 녹음 하나에만, 10분만 유효하다.
app.use('/api/v2/recordings/*', async (c, next) => {
  if (/\/audio$/.test(new URL(c.req.url).pathname) && c.req.query('t')) return next()
  return requireAuth(c, next)
})
app.route('/api/v2', meetingRoutes)
app.route('/api/v2', matterRoutes)
app.route('/api/v2', documentRoutes)
app.route('/api/v2', imageRoutes)

/** 토큰이 통하는지 확인용. 인증만 통과하면 자기 자신을 돌려준다. */
app.get('/api/v2/me', requireAuth, (c) => c.json({ success: true, data: c.get('user') }))

/** 관리자 가드가 실제로 막는지 확인용. */
app.get('/api/v2/admin/_ping', requireAuth, requireAdmin, (c) =>
  c.json({ success: true, data: { admin: true } }))

/**
 * DB 도달 확인용. **공개하지 않는다.**
 * 행 수만 돌려주지만 그것도 내부 구조에 대한 정보다.
 * 헤더가 틀리면 404 로 존재 자체를 숨긴다.
 */
app.get('/api/v2/_probe/db', async (c) => {
  const expected = c.env.PROBE_SECRET
  if (!expected || c.req.header('x-probe-secret') !== expected) {
    return c.json({ ok: false }, 404)
  }
  const started = Date.now()
  const { via } = connectionString(c.env)
  const rows = await withDb(c.env, async (db) => {
    const r = await db.query<{ table_name: string; n: string }>(`
      select 'meetings' as table_name, count(*)::text as n from v2.meetings
      union all select 'customers', count(*)::text from v2.customers
      union all select 'users', count(*)::text from v2.users
      union all select 'transcript_segments', count(*)::text from v2.transcript_segments
      order by 1
    `)
    return r.rows
  })
  return c.json({
    ok: true, via, elapsed_ms: Date.now() - started,
    counts: Object.fromEntries(rows.map((r) => [r.table_name, Number(r.n)])),
  })
})

/** R2 도달 확인용. 프로브와 같은 비밀 헤더를 요구한다. */
app.get('/api/v2/_probe/r2', async (c) => {
  const expected = c.env.PROBE_SECRET
  if (!expected || c.req.header('x-probe-secret') !== expected) return c.json({ ok: false }, 404)
  if (!c.env.UPLOADS) return c.json({ ok: false, reason: 'no binding' }, 500)
  const listed = await c.env.UPLOADS.list({ limit: 1000 })
  const total = listed.objects.reduce((s, o) => s + o.size, 0)
  const sample = listed.objects[0]
  let readable = false
  if (sample) {
    const obj = await c.env.UPLOADS.get(sample.key)
    readable = !!obj && (await obj.arrayBuffer()).byteLength === sample.size
  }
  return c.json({
    ok: true, objects: listed.objects.length, total_bytes: total,
    truncated: listed.truncated, sample: sample?.key, sample_readable: readable,
  })
})

// 아직 이관하지 않은 경로. 사내 백엔드가 처리 중이라는 사실은 알리지 않는다.
app.all('*', (c) => c.json(fail(404, 'Not found'), 404))

app.onError((err, c) => {
  // 원인은 로그에만. 응답으로 내보내면 내부 구조가 드러난다.
  console.error('unhandled:', err instanceof Error ? err.message : String(err))

  // **망가진 id 는 우리 잘못이 아니다.** `/matters/not-a-uuid` 처럼 UUID 가 아닌 값이
  // 그대로 질의로 내려가면 Postgres 가 22P02 로 죽고, 우리는 500 을 냈다.
  // 500 은 「서버가 고장났다」 는 뜻이라 로그와 경보를 오염시키고,
  // 아무나 주소만 고쳐서 500 을 만들어 낼 수 있게 둔다.
  // 없는 것을 물은 것이니 **404 다** — 무엇이 잘못됐는지도 알려 주지 않는다.
  // Workers 의 pg 구현은 `err.code` 를 안 실어 줄 때가 있다 — 실측(2026-08-26)에서
  // `code` 는 undefined 이고 메시지만 왔다. 그래서 **문구도 함께 본다.**
  // 평소에는 문구 대조를 피하지만, 이건 Postgres 가 정하는 고정 문구다.
  const code = (err as { code?: string } | null)?.code
  const msg = err instanceof Error ? err.message : String(err)
  if (code === '22P02' || /invalid input syntax for type uuid/i.test(msg)) {
    return c.json(fail(404, 'Not found'), 404)
  }

  return c.json(fail(500, 'Internal error'), 500)
})

export { AnalysisWorkflow, TranscribeWorkflow }
export default app
