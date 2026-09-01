// 서면 경로 (029)
//
// **전부 담당자만.** 사건과 같은 규칙이다 — 서면은 사건 자료 그 자체다.
//
// 서식이 늘어도 이 파일은 안 바뀐다. `kind` 를 받아 등록부에 묻는다.

import { Hono } from 'hono'
import type { Env, Vars } from '../lib/env'
import { withDb } from '../lib/db'
import { logLine } from '../lib/log'
import { fail } from '../middleware'
import * as MT from '../services/matters'
import * as M from '../services/meetings'
import { listForms, getForm } from '../services/documents'
import { gather, generateDocument, DOC_PERSONA_REV } from '../services/documents/generate'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

/** 어떤 서식이 있나. 화면이 이 목록을 받아 버튼을 그린다. */
app.get('/documents/forms', (c) => c.json({ success: true, data: listForms() }))

/**
 * 지금 이 사건으로 무엇을 만들 수 있나.
 * **버튼을 누르기 전에** 무엇이 부족한지 보여 주려고 있다 — 눌러 놓고 실패하면 늦다.
 */
app.get('/matters/:id/documents/available', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return null
    const ctx = await gather(db, id, { meetingId: c.req.query('meetingId') || null })
    if (!ctx) return null
    return listForms().map((f) => {
      const form = getForm(f.kind)!
      // 화면에서 받을 값은 아직 없다. **그것 때문에 못 만든다고 나오지 않게** 걸러 준다 —
      // 사용자가 지금 채울 수 있는 것과 사건에 없는 것은 다른 이야기다.
      // **어느 쪽인지는 서식이 말해 준다**(`Missing.param`). 문구를 대조하지 않는다.
      const paramNames = new Set((f.params ?? []).map((p) => p.name))
      const all = form.missing(ctx)
      const fillable = all.filter((m) => m.param && paramNames.has(m.param))
      return {
        ...f,
        missing: all.filter((m) => !fillable.includes(m))
          .map((m) => ({ msg: m.msg, fix: m.fix ?? null })),
        // 화면에서 채워야 하는 것은 **입력칸 옆에 안내로** 보여 준다 — 버튼을 막지 않는다.
        needsInput: fillable.map((m) => ({ msg: m.msg, param: m.param })),
      }
    })
  })
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: out })
})

/**
 * **모델에게 보낼 자료를 먼저 보여 준다.**
 *
 * 변호사가 그것을 읽고 「이건 틀렸다 · 이게 빠졌다」 를 알아야 보탤 수 있다.
 * 보여 주지 않으면 나온 소장을 통째로 고쳐 쓰게 되고, 그러면 이 기능을 안 쓴다.
 */
app.get('/matters/:id/documents/brief', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const kind = c.req.query('kind') || 'complaint'
  const form = getForm(kind)
  if (!form) return c.json(fail(400, `알 수 없는 서식입니다: ${kind}`), 400)
  const out = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return null
    const ctx = await gather(db, id, { meetingId: c.req.query('meetingId') || null })
    if (!ctx) return null
    return { kind, label: form.label, brief: form.brief(ctx), missing: form.missing(ctx).map((m) => ({ msg: m.msg, fix: m.fix ?? null })) }
  })
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: out })
})

/** 이 사건의 서면 목록 */
app.get('/matters/:id/documents', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return null
    const r = await db.query(
      // **무엇이 다른지 함께 준다.** 제목은 `사건명 — 소장` 고정이라
      // 여러 번 만들면 화면에 똑같은 줄이 쌓인다. 실제로 갈리는 것은 입력값이다.
      `select id, kind, title, status, meeting_id, model, created_by_email,
              created_at, updated_at, length(coalesce(body,'')) as body_chars,
              input->'params' as params
         from v2.legal_documents where matter_id = $1 order by created_at desc`, [id])
    return r.rows
  })
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: out })
})

/**
 * 서면을 만든다.
 *
 * **재료가 없으면 422 로 무엇이 없는지 돌려준다.** 반쪽 서면을 만들어 주지 않는다 —
 * 법원에 나가는 문서에서 빈자리를 모델이 채우게 두면 그것이 사고다.
 */
app.post('/matters/:id/documents', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const kind = String(b.kind || '')
  if (!getForm(kind)) return c.json(fail(400, `알 수 없는 서식입니다: ${kind || '(없음)'}`), 400)

  const meetingId = typeof b.meetingId === 'string' ? b.meetingId : null
  const params = (b.params && typeof b.params === 'object') ? b.params as Record<string, unknown> : {}

  const ctx = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return null
    return gather(db, id, { meetingId, params })
  })
  if (!ctx) return c.json(fail(404, 'Matter not found'), 404)

  const gen = await generateDocument(c.env, ctx, kind)
  if (!gen.ok) {
    return c.json({ success: false, error: { code: 422, message: '아직 만들 수 없습니다' },
                    missing: gen.missing.map((m) => ({ msg: m.msg, fix: m.fix ?? null })) }, 422)
  }

  const docId = await withDb(c.env, async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into v2.legal_documents
         (matter_id, meeting_id, kind, title, input, result, body, model, persona_rev,
          created_by, created_by_email)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [id, meetingId, gen.kind, gen.title,
       // **생성 당시의 사건 상태를 통째로 박제한다.** 나중에 왜 이렇게 나왔는지 되짚는다.
       JSON.stringify(ctx), JSON.stringify(gen.result), gen.body,
       gen.model, DOC_PERSONA_REV, u.sub, u.email])
    // 서면을 만든 것도 남긴다 (021) — 비닉권 자료로 문서를 뽑은 일이다.
    await M.logAccess(db, {
      userId: u.sub, userEmail: u.email, action: 'create', target: 'document',
      targetId: r.rows[0].id, matterId: id, detail: { kind: gen.kind },
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch(() => {})
    return r.rows[0].id
  })

  logLine('info', 'document.created', {
    mid: id, kind: gen.kind, chars: gen.body.length, model: gen.model,
  })
  return c.json({ success: true, data: { id: docId, kind: gen.kind, title: gen.title, body: gen.body } }, 201)
})

/** 서면 하나. 본문과 원문(result)을 함께 준다. */
app.get('/documents/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    const r = await db.query(
      `select d.* from v2.legal_documents d
         join v2.matters m on m.id = d.matter_id
        where d.id = $1 and m.user_id = $2`, [id, u.sub])
    if (!r.rowCount) return null
    await M.logAccess(db, {
      userId: u.sub, userEmail: u.email, action: 'view', target: 'document',
      targetId: id, matterId: r.rows[0].matter_id,
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch(() => {})
    return r.rows[0]
  })
  if (!out) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: out })
})

/**
 * 본문을 고친다. **모델 출력이 아니라 이것이 문서다** —
 * 변호사가 고친 것이 최종이고, 다시 생성해도 이 문서를 덮지 않는다(새로 만든다).
 */
app.patch('/documents/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  type Patch = { body?: string; status?: string; title?: string }
  const b: Patch = await c.req.json<Patch>().catch(() => ({} as Patch))
  if (b.status && !['draft', 'final', 'filed'].includes(b.status)) {
    return c.json(fail(400, 'status 값이 잘못됐습니다'), 400)
  }
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      `update v2.legal_documents d set
         body = coalesce($3, d.body), status = coalesce($4, d.status),
         title = coalesce($5, d.title), updated_at = now()
       from v2.matters m
       where d.id = $1 and m.id = d.matter_id and m.user_id = $2`,
      [id, u.sub, b.body ?? null, b.status ?? null, b.title ?? null])
    return (r.rowCount ?? 0) > 0
  })
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id } })
})

app.delete('/documents/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      `delete from v2.legal_documents d using v2.matters m
        where d.id = $1 and m.id = d.matter_id and m.user_id = $2`, [id, u.sub])
    return (r.rowCount ?? 0) > 0
  })
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id } })
})

export default app
