// /api/v2/{customers,users,actions} — 사내 백엔드 라우트 3개 이관분 (C-3)
//
// 응답 형태(`{success, data, meta}`)는 그대로 맞춘다. 프런트엔드가 같은 것을 읽는다.
// 달라진 것은 **접근 범위**뿐이다 — 각 서비스 파일 머리말 참고.

import { Hono } from 'hono'
import type { Env, Vars } from '../lib/env'
import { withDb, queryOne } from '../lib/db'
import { fail, requireAdmin } from '../middleware'
import * as C from '../services/customers'
import * as A from '../services/actions'
import * as U from '../services/users'
import * as M from '../services/meetings'
import { hashPassword, passwordProblem } from '../lib/auth'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const paging = (c: { req: { query: (k: string) => string | undefined } }) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 20, 1), 100)
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0)
  return { limit, offset }
}
const meta = (total: number, limit: number, offset: number) =>
  ({ total, limit, offset, hasMore: offset + limit < total })

// ─────────── customers
app.get('/customers', async (c) => {
  const { limit, offset } = paging(c)
  const u = c.get('user')
  const r = await withDb(c.env, (db) => C.listCustomers(db, u.sub, limit, offset))
  return c.json({ success: true, data: r.customers, meta: meta(r.total, limit, offset) })
})

app.post('/customers', async (c) => {
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  if (typeof body.companyName !== 'string' || !body.companyName.trim()) {
    return c.json(fail(400, 'companyName is required'), 400)
  }
  const u = c.get('user')
  const row = await withDb(c.env, (db) => C.createCustomer(db, u.sub, body as never))
  return c.json({ success: true, data: row && C.toCustomer(row) }, 201)
})

app.get('/customers/:id', async (c) => {
  const u = c.get('user')
  const row = await withDb(c.env, (db) =>
    C.getCustomer(db, c.req.param('id'), u.sub, u.role === 'admin'))
  if (!row) return c.json(fail(404, 'Customer not found'), 404)
  return c.json({ success: true, data: C.toCustomer(row) })
})

app.patch('/customers/:id', async (c) => {
  const u = c.get('user')
  const id = c.req.param('id')
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const row = await withDb(c.env, async (db) => {
    // 남의 고객이면 여기서 null 이므로 수정도 못 한다
    if (!await C.getCustomer(db, id, u.sub, u.role === 'admin')) return null
    await C.updateCustomer(db, id, body)
    return C.getCustomer(db, id, u.sub, u.role === 'admin')
  })
  if (!row) return c.json(fail(404, 'Customer not found'), 404)
  return c.json({ success: true, data: C.toCustomer(row) })
})

app.delete('/customers/:id', async (c) => {
  const u = c.get('user')
  const id = c.req.param('id')
  const done = await withDb(c.env, async (db) => {
    if (!await C.getCustomer(db, id, u.sub, u.role === 'admin')) return false
    return C.softDeleteCustomer(db, id)
  })
  if (!done) return c.json(fail(404, 'Customer not found'), 404)
  return c.json({ success: true, data: { message: 'Customer deleted' } })
})

// ─────────── users (자기 자신만)
app.get('/users/me', async (c) => {
  const uid = c.get('user').sub
  const out = await withDb(c.env, async (db) => ({
    row: await U.getUser(db, uid),
    voice: await U.getVoiceRef(db, uid),
  }))
  if (!out.row) return c.json(fail(404, 'User not found'), 404)
  // 저장 경로는 내보내지 않는다 — 화면에 필요한 것은 '등록돼 있는가' 와 길이뿐이다.
  return c.json({
    success: true,
    data: {
      ...U.toUser(out.row),
      voiceRef: out.voice
        ? { durationMs: out.voice.duration_ms, enrolledAt: out.voice.enrolled_at }
        : null,
    },
  })
})

app.patch('/users/me', async (c) => {
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const id = c.get('user').sub
  const row = await withDb(c.env, async (db) => {
    await U.updateUser(db, id, body)     // role 은 화이트리스트에 없어 무시된다
    return U.getUser(db, id)
  })
  if (!row) return c.json(fail(404, 'User not found'), 404)
  return c.json({ success: true, data: U.toUser(row) })
})

// ─────────── actions
app.get('/actions', async (c) => {
  const { limit, offset } = paging(c)
  const u = c.get('user')
  const r = await withDb(c.env, (db) =>
    A.listActions(db, u.sub, u.role === 'admin', { limit, offset, status: c.req.query('status') }))
  return c.json({ success: true, data: r.actions, meta: meta(r.total, limit, offset) })
})

app.post('/actions', async (c) => {
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  if (typeof body.meetingId !== 'string' || typeof body.actionText !== 'string') {
    return c.json(fail(400, 'meetingId and actionText are required'), 400)
  }
  const u = c.get('user')
  const row = await withDb(c.env, async (db) => {
    // 내 미팅에만 액션을 달 수 있다. 원본에는 이 검사가 없었다.
    const owned = await db.query(
      'select 1 from v2.meetings where id = $1 and ($2::boolean or user_id = $3)',
      [body.meetingId, u.role === 'admin', u.sub])
    if (owned.rowCount === 0) return null
    return A.createAction(db, body as never)
  })
  if (!row) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: A.toAction(row) }, 201)
})

app.patch('/actions/:id', async (c) => {
  const u = c.get('user')
  const id = c.req.param('id')
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const row = await withDb(c.env, async (db) => {
    if (!await A.getAction(db, id, u.sub, u.role === 'admin')) return null
    await A.updateAction(db, id, body)
    return A.getAction(db, id, u.sub, u.role === 'admin')
  })
  if (!row) return c.json(fail(404, 'Action not found'), 404)
  return c.json({ success: true, data: A.toAction(row) })
})

app.delete('/actions/:id', async (c) => {
  const u = c.get('user')
  const id = c.req.param('id')
  const done = await withDb(c.env, async (db) => {
    if (!await A.getAction(db, id, u.sub, u.role === 'admin')) return false
    return A.deleteAction(db, id)
  })
  if (!done) return c.json(fail(404, 'Action not found'), 404)
  return c.json({ success: true, data: { message: 'Deleted' } })
})

export default app

// ─────────── 본인 목소리 등록
//
// **본인 것만 등록한다.** 남의 성문(민감정보)을 보관하지 않는 것이 이 기능의 전제다.
// v1 은 참석자 전원 등록으로 시작했다가, 미등록자 발화가 **등록된 다른 사람 이름**으로
// 배정되는 것을 실측하고 본인 단독 등록으로 바꿨다. 같은 설계를 따른다.

/** API 가 요구하는 클립 길이. 벗어나면 STT 가 거절한다. */
const VOICE_MIN_MS = 2000
const VOICE_MAX_MS = 10000
const VOICE_MAX_BYTES = 5 * 1024 * 1024

app.post('/users/me/voice', async (c) => {
  const uid = c.get('user').sub
  const form = await c.req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File)) return c.json(fail(400, 'audio 파일이 필요합니다'), 400)
  if (audio.size > VOICE_MAX_BYTES) return c.json(fail(400, '클립이 너무 큽니다'), 400)

  const durationMs = Number(form?.get('durationMs') ?? 0)
  if (!Number.isFinite(durationMs) || durationMs < VOICE_MIN_MS || durationMs > VOICE_MAX_MS) {
    return c.json(fail(400, `클립은 ${VOICE_MIN_MS / 1000}~${VOICE_MAX_MS / 1000}초여야 합니다`), 400)
  }
  if (!c.env.UPLOADS) return c.json(fail(500, 'Storage unavailable'), 500)

  // 사용자당 하나. 키가 uid + **확장자**라, 같은 확장자로 다시 등록할 때만 덮어써진다 —
  // .webm 으로 등록했다가 .m4a 로 다시 하면 옛 클립이 아무도 안 가리키는 채로 남는다.
  // 그래서 이전 경로를 받아 두고, 새 등록이 자리 잡은 뒤에 지운다.
  const ext = (audio.name.match(/\.[a-z0-9]+$/i)?.[0] || '.webm').toLowerCase()
  const key = `voice-refs/${uid}${ext}`
  const prev = await withDb(c.env, (db) => U.getVoiceRef(db, uid))

  // **파라미터를 떼어 저장한다.** 브라우저의 `mr.mimeType` 은 보통
  // `audio/webm;codecs=opus` 인데, 그대로 두면 STT 로 보낼 data URL 이
  // `data:audio/webm;codecs=opus;base64,…` 가 되고 파라미터를 거절하는 파서가 흔하다.
  // 그러면 4xx 도 안 나고 실명만 조용히 안 붙는다 (2026-08-20).
  //
  // **여기서 고치는 이유**: 클라이언트가 셋(v2 웹·V3 웹·앱)이라 클라이언트를 고치면
  // 넷째가 또 만든다. 읽는 쪽(`lib/voice.ts`)에서도 한 번 더 떼므로 옛 행도 살아난다.
  const mime = (audio.type || 'audio/webm').split(';')[0].trim()

  // File 을 그대로 넘긴다 — `arrayBuffer()` 는 같은 바이트를 메모리에 한 벌 더 만든다.
  await c.env.UPLOADS.put(key, audio, { httpMetadata: { contentType: mime } })
  const ref = {
    storage_path: key,
    duration_ms: Math.round(durationMs),
    mime,
    enrolled_at: new Date().toISOString(),
  }
  await withDb(c.env, (db) => U.setVoiceRef(db, uid, ref))

  if (prev?.storage_path && prev.storage_path !== key) {
    await c.env.UPLOADS.delete(prev.storage_path).catch(() => {})
  }
  return c.json({ success: true, data: ref }, 201)
})

app.delete('/users/me/voice', async (c) => {
  const uid = c.get('user').sub
  const ref = await withDb(c.env, (db) => U.getVoiceRef(db, uid))
  // **행을 먼저 지운다.** R2 삭제가 실패해도 등록은 해제돼야 한다 —
  // "지웠는데 아직 쓰인다" 가 "파일이 남았다" 보다 나쁘다.
  await withDb(c.env, (db) => U.setVoiceRef(db, uid, null))
  if (ref?.storage_path) await c.env.UPLOADS?.delete(ref.storage_path).catch(() => {})
  return c.json({ success: true, data: { message: '등록을 해제했습니다' } })
})

// ─────────── /admin/users — 관리자 전용 (사내 routes/admin.ts 이관분)
//
// 이 셋도 어느 이관 단계에도 없어서 화면의 "사용자 관리" 가 404 였다.
// **가드는 라우트마다 건다.** `app.use` 로 걸면 이 파일이 다른 prefix 로 마운트될 때
// 조용히 빠질 수 있다 — 관리자 경로에서 그런 실수는 값이 너무 크다.

app.get('/admin/users', requireAdmin, async (c) => {
  const rows = await withDb(c.env, (db) => U.listUsers(db))
  return c.json({ success: true, data: rows.map(U.toAdminUser), meta: { total: rows.length } })
})

app.post('/admin/users', requireAdmin, async (c) => {
  type Body = { email?: string; name?: string; password?: string; role?: string }
  const b: Body = await c.req.json<Body>().catch(() => ({} as Body))
  const email = b.email?.trim().toLowerCase()
  const name = b.name?.trim()
  if (!email || !name || !b.password) {
    return c.json(fail(400, 'email, name, password are required'), 400)
  }
  // 비밀번호 변경 경로와 **같은 규칙**을 쓴다. 생성만 느슨하면 그 규칙이 의미가 없어진다.
  const problem = passwordProblem(b.password)
  if (problem) return c.json(fail(400, problem), 400)
  // **본문의 role 을 그대로 쓰지 않는다.** 'admin' 만 인정하고 나머지는 전부 'user' 다.
  const role = b.role === 'admin' ? 'admin' : 'user'
  const row = await withDb(c.env, (db) =>
    U.createUser(db, email, name, hashPassword(b.password!), role))
  if (!row) return c.json(fail(400, 'Email already exists'), 400)
  return c.json({ success: true, data: U.toAdminUser(row) }, 201)
})

/**
 * 지우면 무슨 일이 벌어지는지 **먼저** 보여 준다. 아무것도 지우지 않는다.
 *
 * `CLAUDE.md` — "되돌릴 수 없는 삭제 전에는 목록과 사본을 남긴다."
 * 이 경로가 그 「목록」이다.
 */
app.get('/admin/users/:id/deletion', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const row = await withDb(c.env, (db) =>
    queryOne<{ out: unknown }>(db, 'select v2.user_delete_preview($1) as out', [id]))
  const out = row?.out as { found?: boolean } | undefined
  if (!out?.found) return c.json(fail(404, 'User not found'), 404)
  return c.json({ success: true, data: out })
})

/**
 * 사용자를 **진짜로** 지운다.
 *
 * 막는 것은 셋이다 —
 *   1. 자기 자신 (지우면 되살릴 사람이 없어질 수 있다)
 *   2. 마지막 관리자 (사무소가 문을 못 연다)
 *   3. 사건·상담·고객을 가진 사람 → **DB 함수가 막는다** (`023`)
 *
 * 그리고 **이메일을 그대로 적어야 한다.** 목록에서 잘못 누르는 것을 막는 유일한 방법이다.
 */
app.delete('/admin/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const me = c.get('user')
  if (id === me.sub) return c.json(fail(400, '자기 자신은 지울 수 없습니다'), 400)

  const b = await c.req.json<{ confirm?: string }>().catch(() => ({} as { confirm?: string }))

  const outcome = await withDb(c.env, async (db) => {
    const target = await queryOne<{ email: string; role: string }>(db,
      'select email, role from v2.users where id = $1', [id])
    if (!target) return { kind: 'not-found' as const }

    // **적어 넣은 이메일이 맞아야 한다.** 목록에서 한 줄 잘못 누르는 것을 막는다.
    if ((b.confirm || '').trim().toLowerCase() !== target.email.toLowerCase()) {
      return { kind: 'confirm-mismatch' as const, email: target.email }
    }

    // 마지막 관리자를 지우면 사무소가 문을 못 연다.
    if (target.role === 'admin') {
      const n = await queryOne<{ n: string }>(db,
        "select count(*) as n from v2.users where role = 'admin' and is_active = true")
      if (Number(n?.n ?? 0) <= 1) return { kind: 'last-admin' as const }
    }

    // **지우기 전에 남긴다.** 지운 뒤에는 남길 대상이 없다 (`021`).
    await M.logAccess(db, {
      userId: me.sub, userEmail: me.email, action: 'delete', target: 'user',
      targetId: id, detail: { email: target.email, role: target.role },
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch(() => {})

    try {
      const row = await queryOne<{ out: unknown }>(db, 'select v2.delete_user($1) as out', [id])
      return { kind: 'ok' as const, out: row?.out }
    } catch (e) {
      // DB 함수가 막은 것이다 — 무엇이 막았는지 그대로 전한다
      return { kind: 'blocked' as const, message: e instanceof Error ? e.message : String(e) }
    }
  })

  if (outcome.kind === 'not-found') return c.json(fail(404, 'User not found'), 404)
  if (outcome.kind === 'confirm-mismatch') {
    return c.json(fail(400, `확인을 위해 "${outcome.email}" 을 그대로 입력해 주세요`), 400)
  }
  if (outcome.kind === 'last-admin') {
    return c.json(fail(400, '마지막 관리자는 지울 수 없습니다'), 400)
  }
  if (outcome.kind === 'blocked') return c.json(fail(409, outcome.message), 409)
  return c.json({ success: true, data: outcome.out })
})

/**
 * 그 사람이 맡고 있던 것을 **전부** 다른 담당자에게 넘긴다 (`023` 과 한 묶음).
 *
 * **이것이 없으면 삭제도 비활성화도 막다른 길이다.** 사건은 담당자만 보므로
 * (`021` — 관리자 우회 없음) 담당자가 떠나면 **그 사건을 아무도 못 연다.**
 * 지우기 전에 넘길 곳이 있어야 한다.
 *
 * 사건에 딸린 기한도 함께 간다 — 기한만 옛 담당자에게 남으면 아무도 안 본다.
 */
app.post('/admin/users/:id/transfer', requireAdmin, async (c) => {
  const from = c.req.param('id')
  const me = c.get('user')
  const b = await c.req.json<{ toUserId?: string }>().catch(() => ({} as { toUserId?: string }))
  const to = (b.toUserId || '').trim()
  if (!to) return c.json(fail(400, '넘겨받을 사람을 골라 주세요'), 400)
  if (to === from) return c.json(fail(400, '같은 사람에게는 넘길 수 없습니다'), 400)

  const outcome = await withDb(c.env, async (db) => {
    const dst = await queryOne<{ email: string }>(db,
      'select email from v2.users where id = $1 and is_active = true', [to])
    if (!dst) return { kind: 'bad-target' as const }
    const src = await queryOne<{ email: string }>(db, 'select email from v2.users where id = $1', [from])
    if (!src) return { kind: 'not-found' as const }

    // **삭제를 막는 것 전부를 옮긴다.** 일부만 옮기면 인계한 줄 알았는데
    // 계정은 여전히 안 지워지고, 남은 것이 무엇인지는 화면에 안 보인다.
    // `023` 의 `blockers` 와 **같은 목록**이어야 한다 — 어긋나면 영원히 막힌다.
    const moved: Record<string, number> = {}
    const move = async (label: string, sql: string) => {
      const r = await db.query(sql, [from, to])
      moved[label] = r.rowCount ?? 0
    }
    await move('matters',    'update v2.matters set user_id = $2, updated_at = now() where user_id = $1')
    // 기한도 함께. **사건만 옮기면 기한은 옛 담당자에게 남아 아무도 안 본다.**
    await move('deadlines',  'update v2.deadlines set user_id = $2, updated_at = now() where user_id = $1')
    await move('customers',  'update v2.customers set user_id = $2 where user_id = $1')
    await move('meetings',   'update v2.meetings set user_id = $2 where user_id = $1')
    await move('recordings', 'update v2.meeting_recordings set user_id = $2 where user_id = $1')
    await move('emails',     'update v2.emails set user_id = $2 where user_id = $1')

    await M.logAccess(db, {
      userId: me.sub, userEmail: me.email, action: 'transfer', target: 'user',
      targetId: from, detail: { from: src.email, to: dst.email, ...moved },
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch(() => {})

    return { kind: 'ok' as const, ...moved, to: dst.email }
  })

  if (outcome.kind === 'bad-target') return c.json(fail(400, '넘겨받을 사람을 찾을 수 없습니다 (활성 계정만 가능)'), 400)
  if (outcome.kind === 'not-found') return c.json(fail(404, 'User not found'), 404)
  return c.json({ success: true, data: outcome })
})

/**
 * 관리자가 비밀번호를 재설정한다.
 *
 * **본인만 바꿀 수 있으면 잊었을 때 길이 없다** — 계정을 지우고 새로 만드는 수밖에 없고,
 * 그러면 사건이 딸려 간다. 재설정한 사실은 `access_log` 에 남는다.
 * **새 비밀번호는 응답에 한 번만 나온다.** 저장하지 않는다.
 */
app.post('/admin/users/:id/reset-password', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const me = c.get('user')
  const b = await c.req.json<{ newPassword?: string }>().catch(() => ({} as { newPassword?: string }))
  const next = (b.newPassword || '').trim()
  if (!next) return c.json(fail(400, '새 비밀번호를 입력해 주세요'), 400)
  // 본인이 바꿀 때와 **같은 규칙**을 쓴다. 관리자 경로만 느슨하면 규칙이 의미가 없다.
  const problem = passwordProblem(next)
  if (problem) return c.json(fail(400, problem), 400)

  const outcome = await withDb(c.env, async (db) => {
    const target = await queryOne<{ email: string }>(db, 'select email from v2.users where id = $1', [id])
    if (!target) return null
    await db.query('update v2.users set password_hash = $2, updated_at = now() where id = $1',
      [id, hashPassword(next)])
    // **세션을 전부 끊는다.** 안 끊으면 옛 비밀번호로 들어와 있던 창이 그대로 살아 있다.
    await db.query(
      'update v2.sessions set is_active = false, revoked_at = now() where user_id = $1 and is_active = true',
      [id])
    await M.logAccess(db, {
      userId: me.sub, userEmail: me.email, action: 'reset-password', target: 'user',
      targetId: id, detail: { email: target.email },
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch(() => {})
    return target.email
  })

  if (!outcome) return c.json(fail(404, 'User not found'), 404)
  return c.json({ success: true, data: { email: outcome, message: '비밀번호를 재설정했습니다. 세션은 모두 끊겼습니다.' } })
})

app.patch('/admin/users/:id', requireAdmin, async (c) => {
  const b = await c.req.json<{ isActive?: unknown }>().catch(() => ({} as { isActive?: unknown }))
  if (typeof b.isActive !== 'boolean') {
    return c.json(fail(400, 'isActive (boolean) is required'), 400)
  }
  const id = c.req.param('id')
  // 자기 자신을 끄면 되살릴 사람이 없어질 수 있다
  if (id === c.get('user').sub && b.isActive === false) {
    return c.json(fail(400, 'Cannot deactivate your own account'), 400)
  }
  const done = await withDb(c.env, (db) => U.setActive(db, id, b.isActive as boolean))
  if (!done) return c.json(fail(404, 'User not found'), 404)
  return c.json({ success: true, data: { id, isActive: b.isActive } })
})
