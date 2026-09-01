// /api/v2/{meetings,dashboard,analytics} — C-4a 이관분 (읽기 전용)
// 업로드(`/meetings/:id/audio`)와 분석 트리거는 C-4b·C-5 에서 옮긴다.

import { Hono } from 'hono'
import type { Env, Vars } from '../lib/env'
import { withDb } from '../lib/db'
import { logLine } from '../lib/log'
import { fail } from '../middleware'
import { signMediaTicket, verifyMediaTicket } from '../lib/auth'
import { maskPii } from '../lib/pii'
import * as M from '../services/meetings'
import { attachMeetingToMatter, detachMeetingFromMatter } from '../services/attach'
import * as CUS from '../services/customers'
import * as D from '../services/dashboard'
import * as R from '../services/risk'
import * as RN from '../services/renote'
import * as REC from '../services/recordings'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const paging = (c: { req: { query: (k: string) => string | undefined } }) => ({
  limit: Math.min(Math.max(Number(c.req.query('limit')) || 20, 1), 1000),
  offset: Math.max(Number(c.req.query('offset')) || 0, 0),
})

// ─────────── meetings (생성)
//
// **이 경로가 없어서 화면의 "업로드 및 분석 시작" 이 통째로 막혀 있었다.** 읽기(C-4a)·업로드(C-4b)·
// 분석(C-5) 은 옮겼는데 생성만 어느 단계에도 없었고, 그동안 사내 Express 가 처리하고 있었다.
// 화면이 Cloudflare 로 넘어오면서 갈 곳이 사라져 404 `Not found` 가 났다.
app.post('/meetings', async (c) => {
  const u = c.get('user')
  type Body = {
    customerId?: string; title?: string; startTime?: string; endTime?: string
    durationMinutes?: number; notes?: string
    /** 분석 방식 (016). 안 보내면 general — 법률 분석을 잘못 거는 쪽이 더 나쁘다 */
    kind?: string
    /** 사건. **없어도 정상이다** — 모든 조사이 사건 조사은 아니다 */
    matterId?: string
  }
  const b: Body = await c.req.json<Body>().catch(() => ({} as Body))

  const title = b.title?.trim()
  if (!title) return c.json(fail(400, 'title is required'), 400)
  // **대상자이 없어도 만들 수 있다** (016) — 사무소 내부 회의·거래처 조사.
  // SEP 에서는 필수였다(조사에는 항상 대상자가 있다). IEP 에서는 아니다.
  // start/end 는 NOT NULL 이다. 화면은 둘 다 같은 값을 보낸다(조사 시각 하나만 입력받는다).
  const startTime = b.startTime || new Date().toISOString()
  const endTime = b.endTime || startTime

  const out = await withDb(c.env, async (db) => {
    // 남의 대상자에 조사을 만들 수 없게 한다. FK 만 믿으면 ID 를 아는 것만으로 통과한다.
    // **없으면 검사할 것도 없다** — 대상자 없는 조사은 정상이다.
    if (b.customerId && !await CUS.getCustomer(db, b.customerId, u.sub, u.role === 'admin')) return null
    return M.createMeeting(db, {
      userId: u.sub, customerId: b.customerId || null, title,
      startTime, endTime, durationMinutes: b.durationMinutes, notes: b.notes,
      kind: b.kind, matterId: b.matterId,
    })
  })
  if (!out) return c.json(fail(404, 'Customer not found'), 404)
  return c.json({ success: true, data: M.toMeeting(out) }, 201)
})

// ─────────── meetings (읽기)
app.get('/meetings', async (c) => {
  const { limit, offset } = paging(c)
  const u = c.get('user')
  // 관리자는 전체를 본다. 아래 analytics 는 "내 실적" 이라 관리자여도 본인 것만 센다.
  const r = await withDb(c.env, (db) =>
    M.listMeetings(db, u.sub, limit, offset, u.role === 'admin'))
  return c.json({
    success: true, data: r.meetings,
    meta: { total: r.total, limit, offset, hasMore: offset + limit < r.total },
  })
})

app.get('/meetings/:id', async (c) => {
  const u = c.get('user')
  const row = await withDb(c.env, (db) =>
    M.getMeeting(db, c.req.param('id'), u.sub, u.role === 'admin'))
  if (!row) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: M.toMeeting(row) })
})

// 분석 결과는 `/analysis/meeting/:id` 에 있다 — 사내 백엔드의 실제 경로 그대로다.
// (처음에 `/meetings/:id/analysis` 로 만들었다가 되돌렸다. 프런트엔드가 부르지 않는 경로였다.)
app.get('/analysis/meeting/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    const meeting = await M.getMeeting(db, id, u.sub, u.role === 'admin')
    if (!meeting) return { kind: 'no-meeting' as const }
    const analysis = await M.getAnalysis(db, id)
    if (!analysis) return { kind: 'pending' as const, meeting }
    return { kind: 'ok' as const, analysis }
  })
  if (out.kind === 'no-meeting') return c.json(fail(404, 'Meeting not found'), 404)
  if (out.kind === 'pending') {
    // 원본과 같이 202 다 — 아직 분석 중이라는 뜻이지 오류가 아니다
    return c.json({
      success: true,
      data: {
        meetingId: id,
        status: out.meeting.analysis_status,
        progress: out.meeting.analysis_progress,
        message: '분석이 진행 중입니다',
      },
    }, 202)
  }
  return c.json({ success: true, data: out.analysis })
})

/** 액션 아이템 완료 체크 저장. 소유자(또는 관리자)만. */
/**
 * 분석 결과만 지운다. **조사·메모·녹음·녹취는 남는다.**
 *
 * 근거가 없는 분석(녹음 0건으로 제목만 보고 나온 것 등)을 치우는 길이 그전에는
 * 조사을 통째로 지우는 것뿐이었다 — 그러면 사람이 직접 쓴 메모까지 사라진다.
 * 지운 뒤 상태는 `pending` 이라, 녹음을 붙여 다시 분석하면 그 자리에 들어간다.
 */
app.delete('/analysis/meeting/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    return M.clearAnalysis(db, id)
  })
  if (out === null) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: { meetingId: id, removed: out } })
})

app.patch('/analysis/meeting/:id/action-items', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b = await c.req.json<{ done?: unknown }>().catch(() => ({} as { done?: unknown }))
  if (!Array.isArray(b.done)) return c.json(fail(400, 'done (number[]) is required'), 400)
  const out = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    return M.setActionItemsDone(db, id, b.done as number[])
  })
  if (!out) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: { actionItemsDone: out } })
})

/** 녹취 조회. **조사이면 감사에 남긴다** — 조사 내용 그 자체이기 때문이다 (021). */
app.get('/analysis/meeting/:id/transcript', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  // 원본에는 소유권 검사가 없었다 — 남의 조사 녹취 전문을 ID 만으로 읽을 수 있었다
  const out = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    return M.getSegments(db, id)
  })
  if (!out) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: out })
})

// ─────────── 녹취 수정 · 형광펜 · 부분 재요약 (011)
//
// 전부 **새 경로**다. 기존 엔드포인트는 한 줄도 건드리지 않았다.

/** 한 줄의 내용 또는 형광펜을 고친다. 응답은 갱신된 녹취 전체 — 화면이 다시 읽을 필요가 없다. */
app.patch('/analysis/meeting/:id/segments/:segId', async (c) => {
  const u = c.get('user')
  const body = await c.req.json<{ content?: string; highlights?: { start: number; end: number }[] }>()
    .catch(() => ({} as { content?: string }))

  if (typeof body.content === 'string' && !body.content.trim()) {
    // 빈 줄로 만들면 녹취에 구멍이 생기고 재요약도 그만큼 잃는다.
    // 지우고 싶으면 원문으로 되돌리는 편이 맞다.
    return c.json(fail(400, '내용을 비울 수 없습니다. 되돌리기를 쓰세요.'), 400)
  }

  const out = await withDb(c.env, (db) => M.editSegment(
    db, c.req.param('id'), c.req.param('segId'), u.sub, u.role === 'admin', body))
  if (!out) return c.json(fail(404, 'Segment not found'), 404)
  logLine('info', 'segment.edit', {
    rid: c.get('rid'), mid: c.req.param('id'), seg: c.req.param('segId'),
    kind: typeof body.content === 'string' ? 'content' : 'highlight',
  })
  return c.json({ success: true, data: out })
})

/** AI 원문으로 되돌린다. */
app.post('/analysis/meeting/:id/segments/:segId/revert', async (c) => {
  const u = c.get('user')
  const out = await withDb(c.env, (db) => M.revertSegment(
    db, c.req.param('id'), c.req.param('segId'), u.sub, u.role === 'admin'))
  if (!out) return c.json(fail(404, '되돌릴 원문이 없습니다'), 404)
  return c.json({ success: true, data: out })
})

/**
 * 조사노트와 AI요약만 다시 만든다.
 *
 * 리포트·지표·코칭·스코어카드, 그리고 **체크한 후속 조치는 건드리지 않는다.**
 */
app.post('/analysis/meeting/:id/renote', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    return RN.renote(c.env, db, id, c.get('rid'))
  })
  if (!out) return c.json(fail(404, 'Meeting not found'), 404)
  if (!out.ok) {
    const msg = out.reason === 'no_transcript' ? '녹취가 없어 요약을 만들 수 없습니다'
      : '요약 생성에 실패했습니다. 기존 요약은 그대로 있습니다.'
    return c.json(fail(422, msg), 422)
  }
  return c.json({ success: true, data: out })
})

/**
 * 끝난 조사을 사건에 붙인다 (030).
 *
 * **`PATCH /meetings/:id` 로 하지 않는다.** 칸 하나 바꾸는 일이 아니라
 * 사건 자료를 다시 만드는 일이고, 실패하는 방식이 여러 가지라 각각 다른 답을 줘야 한다.
 */
app.post('/meetings/:id/matter', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const b = await c.req.json<{ matterId?: string }>().catch(() => ({} as { matterId?: string }))
  const matterId = typeof b.matterId === 'string' ? b.matterId.trim() : ''
  if (!matterId) return c.json(fail(400, '사건을 지정해 주십시오'), 400)

  const r = await withDb(c.env, (db) =>
    attachMeetingToMatter(db, id, matterId, u.sub, u.role === 'admin'))

  if ('code' in r) {
    if (r.code === 'MEETING_NOT_FOUND') return c.json(fail(404, '조사을 찾을 수 없습니다'), 404)
    if (r.code === 'MATTER_NOT_FOUND') return c.json(fail(404, '사건을 찾을 수 없습니다'), 404)
    return c.json({
      success: false,
      error: { code: 409, message: `이미 「${r.matterTitle}」 에 붙어 있습니다. 먼저 떼십시오.` },
    }, 409)
  }

  await withDb(c.env, (db) => M.logAccess(db, {
    userId: u.sub, userEmail: u.email, action: 'update', target: 'meeting',
    targetId: id, matterId: r.matterId, detail: { attached: true, rebuilt: r.rebuilt },
    ip: c.req.header('cf-connecting-ip') ?? null,
  })).catch(() => {})

  logLine('info', 'meeting.attached', {
    meeting: id, matter: r.matterId, rebuilt: r.rebuilt,
    tl: r.timeline, ev: r.evidence, el: r.elementsTouched,
  })
  return c.json({ success: true, data: r })
})

/** 뗀다. 이 조사이 만든 시계열·증거만 지운다. */
app.delete('/meetings/:id/matter', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const r = await withDb(c.env, (db) =>
    detachMeetingFromMatter(db, id, u.sub, u.role === 'admin'))
  if ('code' in r) return c.json(fail(404, '조사을 찾을 수 없습니다'), 404)
  await withDb(c.env, (db) => M.logAccess(db, {
    userId: u.sub, userEmail: u.email, action: 'update', target: 'meeting',
    targetId: id, detail: { detached: true, ...r },
    ip: c.req.header('cf-connecting-ip') ?? null,
  })).catch(() => {})
  logLine('info', 'meeting.detached', { meeting: id, tl: r.timelineRemoved, ev: r.evidenceRemoved })
  return c.json({ success: true, data: r })
})

app.patch('/meetings/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const row = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    await M.updateMeeting(db, id, body)
    return M.getMeeting(db, id, u.sub, u.role === 'admin')
  })
  if (!row) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: M.toMeeting(row) })
})

app.delete('/meetings/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const done = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return false
    return M.softDeleteMeeting(db, id)
  })
  if (!done) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: { message: 'Meeting deleted' } })
})

// ─────────── dashboard
app.get('/dashboard/home/me', async (c) =>
  c.json({ success: true, data: await withDb(c.env, (db) => D.getHome(db, c.get('user').sub)) }))

app.get('/dashboard/score/me', async (c) => {
  const score = await withDb(c.env, (db) => D.getUserScore(db, c.get('user').sub))
  // 지어낸 순위표를 걷어냈다. 예전에는 '이순신'·'강감찬' 이라는 존재하지 않는 사람과
  // 항상 2등/50명이 응답에 들어 있었다. 이제 전부 실제 계산이다.
  return c.json({
    success: true,
    data: {
      ...score,
      ranking: { userRank: score.weeklyRank, totalUsers: score.totalUsers },
    },
  })
})

app.get('/dashboard/insights/me', async (c) =>
  c.json({ success: true, data: await withDb(c.env, (db) => D.getUserInsights(db, c.get('user').sub)) }))

// ─────────── analytics
app.get('/analytics/summary', async (c) => {
  const u = c.get('user')
  const { meetings, total } = await withDb(c.env, (db) => M.listMeetings(db, u.sub, 1000, 0))
  const by = (s: string) => meetings.filter((m) => m.analysisStatus === s)
  const completed = by('completed')
  return c.json({
    success: true,
    data: {
      userId: u.sub,
      totalMeetings: total,
      completedMeetings: completed.length,
      processingMeetings: by('processing').length,
      pendingMeetings: by('pending').length,
      completionRate: total > 0 ? Math.round((completed.length / total) * 100) : 0,
      // 원본 그대로. 이름과 달리 '분석 소요 시간' 이 아니라 생성 시각의 평균이다 — §문서 참고
      avgAnalysisTime: completed.length > 0
        ? Math.round(completed.reduce((s, m) => s + new Date(m.createdAt).getTime() / 1000, 0) / completed.length)
        : 0,
      firstMeetingDate: meetings.length ? meetings[meetings.length - 1].createdAt : null,
      lastMeetingDate: meetings.length ? meetings[0].createdAt : null,
    },
  })
})

app.get('/analytics/trends', async (c) => {
  const u = c.get('user')
  const { meetings } = await withDb(c.env, (db) => M.listMeetings(db, u.sub, 1000, 0))
  const trends: Record<number, { week: number; count: number; completed: number }> = {}
  for (const m of meetings) {
    const week = Math.floor((Date.now() - new Date(m.createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
    trends[week] ??= { week, count: 0, completed: 0 }
    trends[week].count++
    if (m.analysisStatus === 'completed') trends[week].completed++
  }
  return c.json({ success: true, data: Object.values(trends).slice(0, 12) })
})

// ─────────── 업로드 (R2) — C-5-4
// 사내 백엔드는 디스크에 쓰고 setImmediate 로 분석을 시작했다.
// 여기서는 R2 에 쓰고 Workflow 를 깨운 뒤 **즉시 202** 를 준다.
app.post('/meetings/:id/audio', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const meeting = await withDb(c.env, (db) => M.getMeeting(db, id, u.sub, u.role === 'admin'))
  if (!meeting) return c.json(fail(404, 'Meeting not found'), 404)

  const form = await c.req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File)) {
    return c.json(fail(400, 'No audio file uploaded (form field: audio)'), 400)
  }
  if (!c.env.UPLOADS || !c.env.ANALYSIS) return c.json(fail(500, 'Storage or workflow binding missing'), 500)

  const ext = (audio.name.match(/\.[a-z0-9]+$/i)?.[0] || '.audio').toLowerCase()
  const key = `meetings/${id}${ext}`

  // 같은 조사에 이미 올라온 것이 있으면 그 키를 기억해 둔다. 키가 조사 id + **확장자**라,
  // .webm 을 올렸다가 .m4a 를 올리면 키가 달라져 옛 파일이 아무도 안 가리키는 채로 남는다.
  // 덮어쓴다고 적혀 있었지만 확장자가 같을 때만 그렇다.
  const prev = await withDb(c.env, (db) => db.query<{ audio_url: string | null }>(
    'select audio_url from v2.meetings where id = $1', [id]))
  const prevKey = prev.rows[0]?.audio_url

  // File 을 그대로 넘긴다. `arrayBuffer()` 로 읽으면 100MB 파일이 메모리에 두 번 올라가는데
  // Worker 한도가 128MB 다. R2 는 Blob 의 길이를 알기 때문에 한 번에 쓴다.
  await c.env.UPLOADS.put(key, audio, {
    httpMetadata: { contentType: audio.type || 'application/octet-stream' },
  })
  logLine('info', 'audio.r2', { rid: c.get('rid'), mid: id, key, bytes: audio.size })

  const durationSeconds = Number(form?.get('durationSeconds')) || null
  await withDb(c.env, (db) => db.query(
    `update v2.meetings set audio_url = $2, audio_duration_seconds = $3, updated_at = now() where id = $1`,
    [id, key, durationSeconds]))
  logLine('info', 'audio.done', { rid: c.get('rid'), mid: id })

  // 행이 새 키를 가리킨 뒤에 지운다. 먼저 지우면 새 업로드가 실패했을 때 둘 다 잃는다.
  if (prevKey && prevKey !== key && !prevKey.startsWith('/')) {
    await c.env.UPLOADS.delete(prevKey).catch(() => {})
    logLine('info', 'audio.superseded', { rid: c.get('rid'), mid: id, old: prevKey })
  }

  const instance = await c.env.ANALYSIS.create({ params: { meetingId: id, source: 'audio', r2Key: key } })
  return c.json({
    success: true,
    data: { meetingId: id, status: 'processing', instanceId: instance.id,
            message: 'Audio received; transcription & analysis started' },
  }, 202)
})

// ─────────── 분석 시작 (Workflow) — C-5-2
// 사내 백엔드의 `POST /meetings/:id/analyze` 와 같은 경로다.
// 다른 점은 **즉시 202 를 주고 내구 실행에 넘긴다**는 것뿐이다.
app.post('/meetings/:id/analyze', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))

  const meeting = await withDb(c.env, (db) => M.getMeeting(db, id, u.sub, u.role === 'admin'))
  if (!meeting) return c.json(fail(404, 'Meeting not found'), 404)
  if (!c.env.ANALYSIS) return c.json(fail(500, 'Workflow binding missing'), 500)

  // 이미 돌고 있으면 새로 띄우지 않는다. status 가 아니라 시작 시각으로 판단한다 —
  // status 로 보면 사용자가 화면에서 초기화한 순간 가드가 뚫린다(v1 F-1 에서 겪었다).
  const running = await withDb(c.env, (db) => db.query<{ n: string }>(
    `select count(*)::text as n from v2.meetings
      where id = $1 and analysis_status = 'processing'
        and analysis_started_at > now() - interval '30 minutes'`, [id]))
  if (Number(running.rows[0]?.n ?? 0) > 0) {
    return c.json(fail(409, '이미 분석이 진행 중입니다'), 409)
  }

  // 녹음 중에 쌓인 코칭 판정을 이 조사에 붙인다 (015).
  // 코칭은 조사보다 먼저 돌기 때문에 `session_id` 로만 쌓여 있다.
  // **실패해도 분석을 막지 않는다** — 연결은 자료를 쓰기 좋게 하는 것이고 분석의 전제가 아니다.
  const coachingSessionId = typeof body.coachingSessionId === 'string' ? body.coachingSessionId : ''
  if (coachingSessionId) {
    await withDb(c.env, (db) => db.query(
      `update v2.coaching_events set meeting_id = $1
        where session_id = $2 and user_id = $3 and meeting_id is null`,
      [id, coachingSessionId, u.sub])).catch((e) => logLine('warn', 'coaching.link_failed', {
        rid: c.get('rid'), mid: id, err: e instanceof Error ? e.message : String(e),
      }))
  }

  let ids = Array.isArray(body.recordingIds) ? (body.recordingIds as string[]) : []
  // 선택한 녹음을 조사에 붙인다 (원본 RecordingService.attach 와 같은 일)
  if (ids.length) await withDb(c.env, (db) => REC.attachRecordings(db, id, ids, u.sub))

  /**
   * **녹음을 안 골랐으면 이미 붙어 있는 것을 쓴다** (2026-08-27).
   *
   * 예전에는 `recordingIds` 가 없으면 `metadata` 로 돌았다. 그건 「제목만으로 분석」 이라
   * 전사문을 안 보고, 끝나면 기존 결과를 **「분석된 녹음이 없습니다」 로 덮어썼다.**
   * 녹음이 여덟 개나 붙어 있는 조사에서도 그랬다 — 인자 하나 빠뜨리면 멀쩡한 분석이 사라진다.
   * 2026-08-27 에 실제로 그렇게 날렸다.
   *
   * 붙어 있는 녹음이 있으면 그것으로 돈다. `metadata` 는 **녹음이 정말 없을 때만**이다.
   */
  if (!ids.length) {
    const attached = await withDb(c.env, (db) => db.query<{ id: string }>(
      `select id from v2.meeting_recordings
        where meeting_id = $1 and segments is not null order by sort_order asc`, [id]))
    ids = attached.rows.map((r) => r.id)
    if (ids.length) {
      logLine('info', 'analysis.reuse_attached', { rid: c.get('rid'), mid: id, n: ids.length })
    }
  }

  /**
   * **`metadata` 는 실수로 갈 수 있는 길이 아니어야 한다** (2026-08-27).
   *
   * 「제목만으로 분석」 은 전사문을 안 본다. 녹음이 붙어 있는데 여기로 새면
   * 멀쩡한 결과가 실패 안내로 덮인다 — 오늘 실제로 그랬다.
   * 붙은 녹음이 없고 **부르는 쪽이 그러겠다고 밝혔을 때만** 간다.
   */
  if (!ids.length && body.allowMetadata !== true) {
    return c.json(fail(400,
      '이 조사에는 분석할 녹음이 없습니다. 제목만으로 분석하려면 allowMetadata 를 켜 주십시오'), 400)
  }
  const instance = await c.env.ANALYSIS.create({
    params: ids.length
      ? { meetingId: id, source: 'recordings', recordingIds: ids }
      : { meetingId: id, source: 'metadata' },
  })
  return c.json({
    success: true,
    data: { meetingId: id, status: 'processing', instanceId: instance.id,
            message: 'Analysis started' },
  }, 202)
})

/** R2 오디오로 분석을 돌린다 (C-5-4 전까지의 확인용). 프로브 비밀이 필요하다. */
app.post('/_probe/analyze-audio', async (c) => {
  if (!c.env.PROBE_SECRET || c.req.header('x-probe-secret') !== c.env.PROBE_SECRET) {
    return c.json({ ok: false }, 404)
  }
  type ProbeBody = { meetingId?: string; r2Key?: string }
  const body: ProbeBody = await c.req.json<ProbeBody>().catch(() => ({} as ProbeBody))
  if (!body.meetingId || !body.r2Key || !c.env.ANALYSIS) return c.json({ ok: false }, 400)
  const instance = await c.env.ANALYSIS.create({
    params: { meetingId: body.meetingId, source: 'audio', r2Key: body.r2Key },
  })
  return c.json({ ok: true, instanceId: instance.id })
})

// ─────────── risk (오디오는 보관하지 않는다 — C-4b · 판정은 남긴다 015)
app.post('/risk', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File)) {
    return c.json(fail(400, 'No audio clip'), 400)
  }
  const str = (k: string) => (typeof form?.get(k) === 'string' ? (form.get(k) as string) : '')
  const sessionId = str('sessionId')
  const atMs = Number(form?.get('atMs')) || 0
  const prevStreak = Number(form?.get('dangerStreak')) || 0
  const uid = c.get('user').sub

  const text = await R.transcribeQuick(c.env, audio)
  if (!text || text.trim().length < 2) {
    // 무음·너무 짧음은 오류가 아니다. 원본과 같은 형태로 정상 응답한다.
    // **기록하지 않는다** — 판정한 것이 없다. 빈 행은 오탐률만 흐린다.
    return c.json({
      success: true,
      data: { level: 'normal', reason: '(무음/짧음)', script: '', action: '',
              transcript: text || '', dangerStreak: 0 },
    })
  }
  // 종류가 코칭 내용을 정한다 (016). 안 오면 가장 조용한 쪽(general)으로 떨어진다.
  const kind = str('kind')
  // **코칭 프롬프트도 밖으로 나간다** (021). 조사이면 가리고 보낸다.
  // 25초 조각이라 대응표는 남기지 않는다 — 되돌릴 일이 없고, 보관을 늘릴 이유도 없다.
  const outbound = kind === 'legal' ? maskPii(text).text : text
  const assessment = await R.assessRisk(c.env, outbound, str('context') || undefined, kind)
  const level = assessment?.level ?? 'normal'
  // 완충은 **서버가** 적용한다 (015). 화면은 받은 값을 그대로 띄운다.
  const { shown, streak } = R.applyHysteresis(level, prevStreak)

  // 판정을 남긴다. **실패해도 코칭을 막지 않는다** — 기록은 안전망이지 전제 조건이 아니다.
  // `sessionId` 가 없으면(옛 화면) 남길 자리가 없으므로 건너뛴다.
  let eventId: string | null = null
  if (sessionId) {
    try {
      eventId = await withDb(c.env, async (db) => {
        const r = await db.query<{ id: string }>(
          // 종류를 함께 남긴다 — **종류별로 오탐률이 다를 수밖에 없고,**
          // 섞어 두면 어느 프롬프트가 시끄러운지 알 수 없다 (016).
          `insert into v2.coaching_events
             (user_id, session_id, at_ms, level, level_shown, danger_streak,
              reason, script, action, transcript, signals)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [uid, sessionId, atMs, level, shown, streak,
           assessment?.reason ?? '', assessment?.script ?? '', assessment?.action ?? '', text,
           JSON.stringify({ kind: kind || 'general' })])
        return r.rows[0]?.id ?? null
      })
    } catch (e) {
      logLine('warn', 'coaching.record_failed', {
        rid: c.get('rid'), err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return c.json({
    success: true,
    data: {
      ...(assessment ?? { level: 'normal', reason: '', script: '', action: '' }),
      level: shown,          // 화면은 완충된 값을 쓴다
      modelLevel: level,     // 모델이 준 원본. 화면은 안 쓰지만 숨길 이유도 없다
      dangerStreak: streak,
      transcript: text,
      eventId,
    },
  })
})

/**
 * 코칭 판정에 대한 사람의 응답. **유일한 정답표다** (015).
 *
 * 이것이 없으면 임계값 보정도 개인화도 영원히 불가능하다 — 무엇이 맞았는지 알 수 없으니.
 * 두 값만 받는다. 회의 중에 누르는 것이라 선택지가 셋 이상이면 아무도 안 누른다.
 */
app.patch('/coaching/:id/feedback', async (c) => {
  const body: { feedback?: string } =
    await c.req.json<{ feedback?: string }>().catch(() => ({}))
  const v = body.feedback
  if (v !== 'helpful' && v !== 'missed') return c.json(fail(400, 'feedback 값이 잘못됐습니다'), 400)
  const ok = await withDb(c.env, async (db) => {
    const r = await db.query(
      `update v2.coaching_events set feedback = $3, feedback_at = now()
        where id = $1 and user_id = $2`,
      [c.req.param('id'), c.get('user').sub, v])
    return (r.rowCount ?? 0) > 0
  })
  // 남의 행이면 404 로 존재를 숨긴다.
  if (!ok) return c.json(fail(404, 'Not found'), 404)
  return c.json({ success: true, data: { id: c.req.param('id'), feedback: v } })
})

/**
 * 법률 분해 결과 (018). 조사 단위(원문·findings)와 사건 단위(요건·타임라인·증거)를 함께 준다.
 *
 * **담기만 하고 못 꺼내면 없는 것과 같다.**
 */
app.get('/legal/meeting/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    const meeting = await M.getMeeting(db, id, u.sub, u.role === 'admin')
    if (!meeting) return null
    const matterId = (meeting as { matter_id?: string | null }).matter_id ?? null

    const [analysis, findings, elements, timeline, evidence] = await Promise.all([
      db.query('select result, model, persona_rev, created_at from v2.legal_analyses where meeting_id = $1', [id]),
      db.query(`select id, kind, severity, detail, refs, question, resolved
                  from v2.findings where meeting_id = $1
                 order by case severity when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end`, [id]),
      matterId ? db.query(`select cause, element, status, note, sort_order
                             from v2.legal_elements where matter_id = $1 order by sort_order`, [matterId])
               : Promise.resolve({ rows: [] as unknown[] }),
      // 타임라인·증거는 **사건 전체**다 — 이 조사 것만 보여 주면 시계열이 끊긴다.
      matterId ? db.query(`select id, occurred_on, precision, what, legal_meaning, meeting_id
                             from v2.timeline_events where matter_id = $1
                            order by occurred_on nulls last`, [matterId])
               : Promise.resolve({ rows: [] as unknown[] }),
      matterId ? db.query(`select id, kind, what, status, holder, difficulty, proves, meeting_id
                             from v2.evidence where matter_id = $1 order by status, kind`, [matterId])
               : Promise.resolve({ rows: [] as unknown[] }),
    ])
    // **여는 것 자체를 남긴다** (021). 실패해도 조회를 막지 않는다 —
    // 감사 때문에 수사관가 자기 사건을 못 보면 안 된다.
    await M.logAccess(db, {
      userId: u.sub, userEmail: u.email, action: 'view', target: 'legal',
      targetId: id, matterId,
      ip: c.req.header('cf-connecting-ip') ?? null,
    }).catch((e) => logLine('warn', 'audit.failed', {
      rid: c.get('rid'), mid: id, err: e instanceof Error ? e.message : String(e),
    }))

    return {
      kind: (meeting as { kind?: string }).kind ?? 'general',
      matterId,
      analysis: analysis.rows[0] ?? null,
      findings: findings.rows,
      elements: elements.rows,
      timeline: timeline.rows,
      evidence: evidence.rows,
    }
  })
  if (!out) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: out })
})

/** 이 조사의 코칭 타임라인. 언제 무엇이 떴고 무엇을 눌렀는지. */
app.get('/coaching/meeting/:id', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    const r = await db.query(
      `select id, at_ms, level, level_shown, danger_streak, reason, script, action,
              transcript, feedback, created_at
         from v2.coaching_events where meeting_id = $1 order by at_ms asc`, [id])
    return r.rows
  })
  if (!out) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: out })
})

// ─────────── recordings (C-5-4)
app.post('/recordings', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File)) return c.json(fail(400, 'No audio file (field: audio)'), 400)
  const label = typeof form?.get('label') === 'string' ? (form.get('label') as string) : null
  const dur = Number(form?.get('durationSeconds')) || null
  const rec = await REC.createDraft(c.env, c.get('user').sub, audio, label, dur, c.get('rid'))
  return c.json({ success: true, data: rec }, 201)
})

/** 이 조사의 녹음 목록. 재생기가 무엇을 틀지 고르는 데 쓴다 (012). */
app.get('/meetings/:id/recordings', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  const out = await withDb(c.env, async (db) => {
    if (!await M.getMeeting(db, id, u.sub, u.role === 'admin')) return null
    return REC.listMeetingRecordings(db, id)
  })
  if (!out) return c.json(fail(404, 'Meeting not found'), 404)
  return c.json({ success: true, data: out })
})

/**
 * 재생 티켓 (012). `<audio src>` 는 헤더를 붙일 수 없어 토큰이 URL 에 실려야 하는데,
 * 액세스 토큰은 계정 전체 권한이고 한 시간을 산다 — 주소가 새면 그동안 계정이 열린다.
 * **이 녹음 하나만, 10분만** 여는 티켓을 따로 준다.
 */
app.post('/recordings/:id/audio-ticket', async (c) => {
  const u = c.get('user'); const id = c.req.param('id')
  // 티켓을 주기 전에 권한을 본다. 여기서 막으면 티켓 자체가 나가지 않는다.
  const ok = await withDb(c.env, (db) => db.query(
    'select 1 from v2.meeting_recordings where id = $1 and ($2::boolean or user_id = $3)',
    [id, u.role === 'admin', u.sub]))
  if (!ok.rowCount) return c.json(fail(404, 'Recording not found'), 404)
  return c.json({ success: true, data: { ticket: await signMediaTicket(c.env, u.sub, id) } })
})

/**
 * 녹음 오디오 (012). 전사가 맞는지 확인하려면 원본을 들어야 한다.
 *
 * **저장된 오디오를 돌려주는 첫 경로다** — 지금까지는 들을 방법이 아예 없었다.
 * 서명 URL 대신 Worker 가 중계한다: 서명 URL 은 주소를 가진 사람이면 누구든 듣는다.
 *
 * 인증은 헤더(일반 요청) 또는 `?t=` 티켓(오디오 태그) 둘 다 받는다.
 */
app.get('/recordings/:id/audio', async (c) => {
  const id = c.req.param('id')
  const ticket = c.req.query('t')

  let userId: string; let isAdmin = false
  if (ticket) {
    const v = await verifyMediaTicket(c.env, ticket, id)
    // 티켓은 이 녹음 하나에만 유효하다. 관리자 권한은 싣지 않는다 —
    // 발급 시점에 이미 확인했고, 좁을수록 좋다.
    if (!v) return c.json(fail(404, 'Recording not found'), 404)
    userId = v.sub
  } else {
    const u = c.get('user')
    if (!u) return c.json(fail(401, 'Unauthorized'), 401)
    userId = u.sub; isAdmin = u.role === 'admin'
  }

  const res = await withDb(c.env, (db) => REC.getRecordingAudio(
    c.env, db, id, userId, isAdmin, c.req.header('range') || null))
  if (!res) return c.json(fail(404, 'Recording not found'), 404)
  return res
})

app.get('/recordings/drafts', async (c) =>
  c.json({ success: true, data: await withDb(c.env, (db) => REC.listDrafts(db, c.get('user').sub)) }))

app.patch('/recordings/:id', async (c) => {
  const body: Record<string, unknown> =
    await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const rec = await withDb(c.env, (db) =>
    REC.updateRecording(db, c.req.param('id'), c.get('user').sub, body))
  if (!rec) return c.json(fail(404, 'Recording not found'), 404)
  return c.json({ success: true, data: rec })
})

app.delete('/recordings/:id', async (c) => {
  const ok = await withDb(c.env, (db) =>
    REC.removeRecording(c.env, db, c.req.param('id'), c.get('user').sub))
  if (!ok) return c.json(fail(404, 'Recording not found'), 404)
  return c.json({ success: true, data: { id: c.req.param('id') } })
})

export default app
