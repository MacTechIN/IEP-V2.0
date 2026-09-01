// 사건 경로 (016~022)
//
// **전부 담당자만.** 관리자 우회가 없다 — 사건은 기본이 비닉권 대상이고,
// 여기서 열어 두면 021 에서 미팅을 좁힌 의미가 사라진다.

import { Hono } from 'hono'
import type { Env, Vars } from '../lib/env'
import { withDb } from '../lib/db'
import { logLine } from '../lib/log'
import { fail } from '../middleware'
import * as MT from '../services/matters'
import { exportMatter, previewOf } from '../services/matterExport'
import * as M from '../services/meetings'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

app.get('/matters', async (c) => {
  const u = c.get('user')
  const status = c.req.query('status') || undefined
  const rows = await withDb(c.env, (db) => MT.listMatters(db, u.sub, status))
  return c.json({ success: true, data: rows })
})

/**
 * 이해충돌 검사. **`/matters/:id` 보다 먼저 선언해야 한다** —
 * 뒤에 두면 `conflicts` 가 사건 id 로 잡혀 404 가 난다.
 */
app.get('/matters/conflicts', async (c) => {
  const u = c.get('user')
  const name = c.req.query('name') || ''
  if (!name.trim()) return c.json({ success: true, data: { asAdverse: [], asClient: [] } })
  const out = await withDb(c.env, (db) => MT.checkConflict(db, u.sub, name))
  return c.json({ success: true, data: out })
})

/** 파기 대상. **보여 주기만 한다** (022) — 지우는 것은 사람이 따로 부를 때뿐이다. */
app.get('/matters/purge-candidates', async (c) => {
  const u = c.get('user')
  const r = await withDb(c.env, (db) => db.query(
    `select matter_id, title, file_no, closed_on, retention_years, purge_on,
            days_over, meetings, deadlines, evidence
       from v2.purge_candidates where user_id = $1 order by purge_on asc`, [u.sub]))
  return c.json({ success: true, data: r.rows })
})

/**
 * 사건 하나를 통째로 꺼낸다. **지우기 전에 남기는 사본이다** (030).
 *
 * 서면은 본문까지 담는다 — 다시 만들 수 없는 것은 그것뿐이다.
 */
app.get('/matters/:id/export', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, (db) => exportMatter(db, id, u.sub, u.role === 'admin'))
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  await withDb(c.env, (db) => M.logAccess(db, {
    userId: u.sub, userEmail: u.email, action: 'export', target: 'matter',
    targetId: id, matterId: id, ip: c.req.header('cf-connecting-ip') ?? null,
  })).catch(() => {})
  return c.json({ success: true, data: out })
})

/** 지우면 무엇이 사라지고 무엇이 남는가. **누르기 전에 보여 준다.** */
app.get('/matters/:id/delete-preview', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, (db) => exportMatter(db, id, u.sub, u.role === 'admin'))
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: previewOf(out) })
})

/**
 * 사건을 지운다.
 *
 * **사건명을 그대로 적어야 지워진다.** 목록에서 한 줄 잘못 누르는 것을 막는다 —
 * 사용자 삭제(023)와 같은 규칙이다.
 *
 * **응답에 사본을 통째로 담아 돌려준다.** 안내가 아니라 구조로 「사본을 남긴다」 를 지킨다.
 */
app.delete('/matters/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b = await c.req.json<{ confirm?: string }>().catch(() => ({} as { confirm?: string }))

  const snapshot = await withDb(c.env, (db) => exportMatter(db, id, u.sub, u.role === 'admin'))
  if (!snapshot) return c.json(fail(404, 'Matter not found'), 404)

  const title = String(snapshot.matter.title ?? '')
  if ((b.confirm || '').trim() !== title.trim()) {
    return c.json(fail(400, `확인을 위해 사건명 「${title}」 을 그대로 적어 주십시오`), 400)
  }

  const preview = previewOf(snapshot)
  await withDb(c.env, async (db) => {
    // 지운 것을 남긴다 (021). **비닉권 자료를 없앤 일이다.**
    await M.logAccess(db, {
      userId: u.sub, userEmail: u.email, action: 'delete', target: 'matter',
      targetId: id, matterId: id, detail: preview as unknown as Record<string, unknown>,
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch(() => {})
    // 딸린 것은 외래키가 정리한다 — 상대방·기한·증거·서면·요건·시계열은 함께,
    // 상담·녹음은 `matter_id` 만 비워지고 남는다.
    await db.query('delete from v2.matters where id = $1 and ($2 or user_id = $3)',
                   [id, u.role === 'admin', u.sub])
  })

  logLine('info', 'matter.deleted', {
    mid: id, docs: preview.destroys.documents, meetings: preview.detaches.meetings,
  })
  return c.json({ success: true, data: { deleted: preview, snapshot } })
})

app.post('/matters', async (c) => {
  const u = c.get('user')
  const b: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
  const title = String(b.title || '').trim()
  if (!title) return c.json(fail(400, '사건명을 입력해 주세요'), 400)

  const id = await withDb(c.env, async (db) => {
    // 남의 의뢰인에 사건을 만들 수 없게 한다.
    if (b.clientId) {
      const ok = await db.query('select 1 from v2.customers where id = $1 and user_id = $2',
        [b.clientId, u.sub])
      if (!ok.rowCount) return null
    }
    return MT.createMatter(db, {
      userId: u.sub, clientId: b.clientId, title,
      fileNo: b.fileNo, courtCaseNo: b.courtCaseNo, matterType: b.matterType,
      cause: b.cause, court: b.court, openedOn: b.openedOn, notes: b.notes,
    })
  })
  if (!id) return c.json(fail(404, 'Client not found'), 404)
  const row = await withDb(c.env, (db) => MT.getMatter(db, id, u.sub))
  return c.json({ success: true, data: row ? MT.toMatter(row) : { id } }, 201)
})

app.get('/matters/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    const row = await MT.getMatter(db, id, u.sub)
    if (!row) return null
    const detail = await MT.matterDetail(db, id)
    // **사건을 여는 것도 남긴다** (021). 비닉권 자료가 모여 있는 화면이다.
    await M.logAccess(db, {
      userId: u.sub, userEmail: u.email, action: 'view', target: 'matter',
      targetId: id, matterId: id, ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch((e) => logLine('warn', 'audit.failed', {
      rid: c.get('rid'), err: e instanceof Error ? e.message : String(e),
    }))
    return { ...MT.toMatter(row), ...detail }
  })
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: out })
})

app.patch('/matters/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const row = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return null
    await MT.updateMatter(db, id, u.sub, b)
    return MT.getMatter(db, id, u.sub)
  })
  if (!row) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: MT.toMatter(row) })
})

app.post('/matters/:id/adverse-parties', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
  const name = String(b.name || '').trim()
  if (!name) return c.json(fail(400, '상대방 이름을 입력해 주세요'), 400)
  const ok = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return false
    await MT.addAdverseParty(db, id, { name, role: b.role, note: b.note })
    return true
  })
  if (!ok) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: { matterId: id, name } }, 201)
})

const EL_STATUS = ['SATISFIED', 'PARTIAL', 'MISSING', 'CONTESTED']

/**
 * 요건을 손으로 더한다 (`018`·`025`).
 *
 * 템플릿(`element_templates`)은 **민법 조문에서 뽑은 뼈대**일 뿐이다.
 * 사건마다 다투는 자리가 다르고, 사무소마다 확인하는 것이 다르다.
 * 뼈대를 고칠 수 없으면 그 체크리스트는 곧 안 보게 된다.
 */
app.post('/matters/:id/elements', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
  const element = String(b.element || '').trim()
  if (!element) return c.json(fail(400, '요건 이름을 입력해 주세요'), 400)
  if (b.status && !EL_STATUS.includes(String(b.status))) {
    return c.json(fail(400, `상태 값이 잘못됐습니다: ${b.status}`), 400)
  }
  const out = await withDb(c.env, async (db) => {
    const m = await MT.getMatter(db, id, u.sub)
    if (!m) return null
    // 청구원인이 아직 없는 사건에도 요건을 더할 수 있어야 한다 — 첫 상담 전이 그렇다.
    const cause = String(b.cause || m.cause || '사용자 지정')
    const r = await db.query<{ id: string }>(
      `insert into v2.legal_elements
         (matter_id, cause, element, sort_order, status, note, set_by, set_by_email, set_at)
       values ($1,$2,$3,
               coalesce($4, (select coalesce(max(sort_order),0)+1 from v2.legal_elements where matter_id=$1)),
               $5,$6,'human',$7,now())
       on conflict (matter_id, cause, element) do nothing
       returning id`,
      [id, cause, element, b.sortOrder ?? null, b.status || 'MISSING', b.note || null, u.email])
    // 같은 이름이 이미 있으면 조용히 넘어가지 않는다 — 안 생겼는데 생긴 줄 알면 안 된다
    if (!r.rowCount) return 'duplicate' as const
    return r.rows[0].id
  })
  if (out === null) return c.json(fail(404, 'Matter not found'), 404)
  if (out === 'duplicate') return c.json(fail(409, `「${element}」 은 이미 있습니다`), 409)
  return c.json({ success: true, data: { id: out } }, 201)
})

/**
 * 요건 하나를 고친다. **고치는 순간 `set_by = 'human'` 이 된다** (`025`) —
 * 그 뒤로는 AI 분석이 이 행을 덮지 않는다.
 */
app.patch('/elements/:eid', async (c) => {
  const u = c.get('user'); const eid = c.req.param('eid')
  const b: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
  if (b.status && !EL_STATUS.includes(String(b.status))) {
    return c.json(fail(400, `상태 값이 잘못됐습니다: ${b.status}`), 400)
  }
  // `set_by` 를 'ai' 로 되돌리면 다음 분석부터 다시 AI 가 채운다. 그것도 사람만 할 수 있다.
  const back = b.setBy === 'ai'
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      `update v2.legal_elements e
          set status = coalesce($3, e.status),
              note   = coalesce($4, e.note),
              element = coalesce($5, e.element),
              set_by = case when $6::boolean then 'ai' else 'human' end,
              set_by_email = case when $6::boolean then null else $7 end,
              set_at = now(), updated_at = now()
         from v2.matters m
        where e.id = $1 and m.id = e.matter_id and m.user_id = $2`,
      [eid, u.sub, b.status ?? null, b.note ?? null,
       b.element ? String(b.element).trim() : null, back, u.email])
    return (r.rowCount ?? 0) > 0
  })
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id: eid, setBy: back ? 'ai' : 'human' } })
})

/** 요건을 뺀다. **사건에 안 맞는 요건이 남아 있으면 「채워지지 않은 것」 수가 거짓이 된다.** */
app.delete('/elements/:eid', async (c) => {
  const u = c.get('user'); const eid = c.req.param('eid')
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      `delete from v2.legal_elements e
         using v2.matters m
        where e.id = $1 and m.id = e.matter_id and m.user_id = $2`, [eid, u.sub])
    return (r.rowCount ?? 0) > 0
  })
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id: eid } })
})

/** 기한 추가·수정. **확정은 누가 했는지가 함께 남는다** (017). */
app.post('/matters/:id/deadlines', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
  if (!b.title || !b.dueOn) return c.json(fail(400, '제목과 기한 날짜가 필요합니다'), 400)
  // 종류를 여기서 걸러 낸다. 안 그러면 CHECK 제약에 걸려 **500 "Internal error"** 로 나가고,
  // 화면에서는 무엇이 잘못됐는지 알 길이 없다.
  const KINDS = ['prescription', 'exclusion', 'appeal', 'filing', 'hearing', 'notice', 'other']
  if (b.kind && !KINDS.includes(String(b.kind))) {
    return c.json(fail(400, `기한 종류가 잘못됐습니다: ${b.kind}`), 400)
  }
  const out = await withDb(c.env, async (db) => {
    if (!await MT.getMatter(db, id, u.sub)) return null
    // **사람이 직접 넣은 것은 확정이다.** AI 가 뽑은 것만 추정으로 남는다.
    const estimated = b.isEstimated === true
    // 확정이면 **누가 언제** 를 함께 넣어야 한다 — `deadlines_confirm_needs_who` 가 그것을 요구한다.
    // 안 넣으면 제약에 걸려 500 이 나고, 화면에서는 기한이 그냥 안 생긴다 (2026-08-26 실측).
    const r = await db.query<{ id: string }>(
      `insert into v2.deadlines
         (user_id, matter_id, kind, title, due_on, starts_on, basis, is_estimated,
          confirmed_by, confirmed_at, confirmed_by_email)
       values ($1,$2,$3,$4,$5,$6,$7,$8,
               case when $8 then null else $1::uuid end,
               case when $8 then null else now() end,
               case when $8 then null else $9::text end)
       returning id`,
      [u.sub, id, b.kind || 'other', b.title, b.dueOn, b.startsOn || null, b.basis || null,
       estimated, u.email])
    return r.rows[0]?.id ?? null
  })
  if (!out) return c.json(fail(404, 'Matter not found'), 404)
  return c.json({ success: true, data: { id: out } }, 201)
})

/** 기한을 확정한다 (017). **누가 언제 확정했는지가 DB 제약으로 필요하다.** */
app.patch('/deadlines/:id/confirm', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      // **이메일도 함께 남긴다** (024). `confirmed_by` 는 계정이 지워지면 null 이 되지만
      // 이메일은 남는다 — 사람이 회사를 떠나도 누가 그 날짜를 확정했는지는 남아야 한다.
      `update v2.deadlines
          set is_estimated = false, confirmed_by = $2, confirmed_by_email = $3,
              confirmed_at = now(), updated_at = now()
        where id = $1 and user_id = $2`, [id, u.sub, u.email])
    return (r.rowCount ?? 0) > 0
  })
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id, isEstimated: false } })
})

app.patch('/deadlines/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
  if (b.status && !['open', 'done', 'dismissed'].includes(String(b.status))) {
    return c.json(fail(400, 'status 값이 잘못됐습니다'), 400)
  }
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      `update v2.deadlines set status = coalesce($3, status), note = coalesce($4, note),
              updated_at = now()
        where id = $1 and user_id = $2`, [id, u.sub, b.status ?? null, b.note ?? null])
    return (r.rowCount ?? 0) > 0
  })
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id } })
})

/** 다가오는 기한 — 대시보드용. 사건을 넘나든다. */
app.get('/deadlines', async (c) => {
  const u = c.get('user')
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 60))
  const r = await withDb(c.env, (db) => db.query(
    // **`basis` 를 함께 준다.** 대시보드에서 「확정」 을 누르는 것은 날짜에 책임을 지는 일이다 —
    // 무엇을 근거로 잡힌 날짜인지 안 보이면 확정할 수 없고, 확정 못 하는 추정은 계속 쌓인다.
    `select d.id, d.kind, d.title, d.due_on, d.is_estimated, d.status, d.basis, d.note,
            d.confirmed_by_email, d.confirmed_at,
            v2.deadline_days_left(d.due_on) as days_left,
            m.id as matter_id, m.title as matter_title, m.file_no as matter_file_no
       from v2.deadlines d join v2.matters m on m.id = d.matter_id
      where d.user_id = $1 and d.status = 'open'
        and d.due_on <= current_date + $2::integer
      order by d.due_on asc`, [u.sub, days]))
  return c.json({ success: true, data: r.rows })
})

export default app
