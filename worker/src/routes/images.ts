/**
 * 이미지 증적·참조 자료 (S7) — 조사에 붙이는 이미지.
 *
 * **입력 이유가 필수** (§0-3). 원본은 R2 에 불변, 입력 시 SHA-256 (§0-4).
 * Vision 사실 분석은 원본과 별도로 담는다 (imageVision.ts, 판정 아님).
 */
import { Hono } from 'hono'
import type { Env, Vars } from '../lib/env'
import { withDb } from '../lib/db'
import { logLine } from '../lib/log'
import { fail } from '../middleware'
import * as M from '../services/meetings'
import { describeImage } from '../services/imageVision'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const IMG_MIME = /^image\/(jpeg|png|webp|gif|heic|heif)$/i
const MAX_BYTES = 10 * 1024 * 1024   // 10MB

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 이 조사를 볼 수 있는 사람인지. 아니면 null. */
async function ownedMeeting(c: any, meetingId: string) {
  const u = c.get('user')
  return withDb(c.env, (db) => M.getMeeting(db, meetingId, u.sub, u.role === 'admin'))
}

// 조사에 이미지 붙이기 — 이유 필수 (§0-3)
app.post('/meetings/:id/images', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  if (!await ownedMeeting(c, id)) return c.json(fail(404, 'Meeting not found'), 404)
  if (!c.env.UPLOADS) return c.json(fail(500, 'Storage unavailable'), 500)

  const form = await c.req.formData().catch(() => null)
  const image = form?.get('image')
  const reason = String(form?.get('reason') || '').trim()
  const lf = String(form?.get('linkedFindingId') || '').trim()
  const linkedFindingId = lf || null

  if (!(image instanceof File)) return c.json(fail(400, '이미지 파일이 없습니다 (form field: image)'), 400)
  if (!IMG_MIME.test(image.type)) return c.json(fail(400, '이미지 형식만 됩니다 (jpeg·png·webp·gif·heic)'), 400)
  if (image.size > MAX_BYTES) return c.json(fail(400, '이미지는 10MB 이하여야 합니다'), 400)
  // **이유가 없으면 받지 않는다** — 목적 없는 이미지는 증적이 아니다.
  if (!reason) return c.json(fail(400, '입력 이유를 적어야 합니다 — 왜 이 이미지를 넣는지'), 400)

  const buf = await image.arrayBuffer()
  const sha256 = hex(await crypto.subtle.digest('SHA-256', buf))
  const ext = (image.name.match(/\.[a-z0-9]+$/i)?.[0]
    || (image.type.includes('png') ? '.png' : image.type.includes('webp') ? '.webp' : '.jpg')).toLowerCase()
  const key = `meetings/${id}/images/${sha256.slice(0, 16)}${ext}`

  await c.env.UPLOADS.put(key, buf, { httpMetadata: { contentType: image.type } })
  const row = await withDb(c.env, (db) => db.query<{ id: string }>(
    `insert into v2.meeting_images
       (meeting_id, r2_key, sha256, mime, bytes, reason, linked_finding_id, captured_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [id, key, sha256, image.type, image.size, reason, linkedFindingId, u.sub]))
  logLine('info', 'image.attached', { rid: c.get('rid'), mid: id, key, bytes: image.size })
  return c.json({ success: true, data: { id: row.rows[0].id, sha256, bytes: image.size } }, 201)
})

// 조사의 이미지 목록 (메타만 — 원본은 /images/:id/raw)
app.get('/meetings/:id/images', async (c) => {
  const id = c.req.param('id')
  if (!await ownedMeeting(c, id)) return c.json(fail(404, 'Meeting not found'), 404)
  const r = await withDb(c.env, (db) => db.query(
    `select id, sha256, mime, bytes, reason, linked_finding_id, description, analyzed_at,
            captured_at, created_at
       from v2.meeting_images where meeting_id = $1 order by created_at`, [id]))
  return c.json({ success: true, data: r.rows })
})

// 원본 이미지 서빙 (표시용) — 담당자만. 프론트가 인증 fetch 로 blob 을 받는다.
app.get('/images/:id/raw', async (c) => {
  const id = c.req.param('id')
  const row = await withDb(c.env, (db) => db.query<{ r2_key: string; mime: string; meeting_id: string }>(
    'select r2_key, mime, meeting_id from v2.meeting_images where id = $1', [id]))
  const img = row.rows[0]
  if (!img || !await ownedMeeting(c, img.meeting_id)) return c.json(fail(404, 'Image not found'), 404)
  if (!c.env.UPLOADS) return c.json(fail(500, 'Storage unavailable'), 500)
  const obj = await c.env.UPLOADS.get(img.r2_key)
  if (!obj) return c.json(fail(404, 'Image data missing'), 404)
  return new Response(obj.body, {
    headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=3600' },
  })
})

// 이미지 사실 분석 (Vision, S7-b) — 판정 아님. 결과를 description 에 담는다.
app.post('/images/:id/analyze', async (c) => {
  const id = c.req.param('id')
  const row = await withDb(c.env, (db) => db.query<{ r2_key: string; mime: string; meeting_id: string; reason: string }>(
    'select r2_key, mime, meeting_id, reason from v2.meeting_images where id = $1', [id]))
  const img = row.rows[0]
  if (!img || !await ownedMeeting(c, img.meeting_id)) return c.json(fail(404, 'Image not found'), 404)
  if (!c.env.UPLOADS) return c.json(fail(500, 'Storage unavailable'), 500)
  const obj = await c.env.UPLOADS.get(img.r2_key)
  if (!obj) return c.json(fail(404, 'Image data missing'), 404)

  const desc = await describeImage(c.env, await obj.arrayBuffer(), img.mime, img.reason)
  if (!desc) return c.json(fail(502, '이미지 분석이 결과를 내지 못했습니다. 다시 시도해 주십시오.'), 502)
  await withDb(c.env, (db) => db.query(
    'update v2.meeting_images set description = $2::jsonb, analyzed_at = now() where id = $1',
    [id, JSON.stringify(desc)]))
  logLine('info', 'image.analyzed', { rid: c.get('rid'), mid: img.meeting_id, id })
  return c.json({ success: true, data: desc })
})

// 이미지 삭제 — 사람이 정한다 (§0). 원본 R2 도 지운다.
app.delete('/images/:id', async (c) => {
  const id = c.req.param('id')
  const row = await withDb(c.env, (db) => db.query<{ r2_key: string; meeting_id: string }>(
    'select r2_key, meeting_id from v2.meeting_images where id = $1', [id]))
  const img = row.rows[0]
  if (!img || !await ownedMeeting(c, img.meeting_id)) return c.json(fail(404, 'Image not found'), 404)
  await withDb(c.env, (db) => db.query('delete from v2.meeting_images where id = $1', [id]))
  if (c.env.UPLOADS && !img.r2_key.startsWith('/')) await c.env.UPLOADS.delete(img.r2_key).catch(() => {})
  logLine('info', 'image.deleted', { rid: c.get('rid'), mid: img.meeting_id, key: img.r2_key })
  return c.json({ success: true })
})

export default app
