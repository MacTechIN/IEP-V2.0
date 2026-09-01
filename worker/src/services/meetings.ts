// 조사 읽기 — 사내 백엔드 services/meetingService.ts 의 조회 부분 이관분 (C-4a)
// 쓰기(업로드·분석)는 C-4b·C-5 다.
//
// **소유권 검사를 추가했다.** 대상자과 같은 구멍이 여기에도 있었고, 이쪽이 더 무겁다 —
// 조사에는 녹취 전문과 분석 결과가 들어 있다.
// 원본은 목록만 `user_id` 로 걸러내고 단건 조회·수정·삭제는 ID 만 맞으면 통과시켰다.

import type pg from 'pg'
import { queryOne } from '../lib/db'

export interface MeetingRow {
  id: string; user_id: string; customer_id: string | null; title: string
  start_time: string | null; end_time: string | null; duration_minutes: number | null
  audio_url: string | null; transcription: string | null; notes: string | null
  analysis_status: string | null; analysis_progress: number | null; created_at: string
  analysis_stage?: string | null; analysis_error?: string | null
  /** 실패는 아니지만 덜 된 것 (028) */
  analysis_note?: string | null
  /** 조사 종류를 정한다 (016·031). interrogation·witness·victim·interview·meeting */
  kind?: string | null
  matter_id?: string | null
  privileged?: boolean | null
  analysis_started_at?: string | null
  company_name?: string | null; overall_score?: string | null
  transcript_edited_at?: Date | null
  note_generated_at?: Date | null
}

export const toMeeting = (r: MeetingRow) => ({
  id: r.id,
  userId: r.user_id,
  customerId: r.customer_id,
  title: r.title,
  startTime: r.start_time,
  endTime: r.end_time,
  durationMinutes: r.duration_minutes || 0,
  audioUrl: r.audio_url,
  transcription: r.transcription,
  notes: r.notes,
  analysisStatus: r.analysis_status,
  analysisProgress: r.analysis_progress,
  // C-5: 실패 시 무엇이 왜 멈췄는지. 예전에는 화면이 실패도 '진행 중' 으로 보여줬다.
  analysisStage: r.analysis_stage ?? null,
  analysisError: r.analysis_error ?? null,
  // **비어 있으면 온전히 끝난 것이다** (028). 화면은 값이 있을 때만 안내를 띄운다.
  analysisNote: r.analysis_note ?? null,
  // **화면이 어떤 분석이 걸렸는지 항상 알 수 있어야 한다.** 조용히 정해지면 안 된다 (016).
  kind: r.kind ?? 'general',
  matterId: r.matter_id ?? null,
  // 비닉권 대상인가 (021). 화면이 내보내기·인쇄에 표시를 박는 근거다.
  privileged: r.privileged ?? false,
  // **한 번이라도 분석을 시작했는가.** `pending` 만으로는 "아직 안 돌렸다" 와
  // "막 큐에 들어갔다" 를 구분할 수 없어, 화면이 끝나지 않는 진행바를 띄웠다 (2026-08-20).
  analysisStartedAt: r.analysis_started_at ?? null,
  // 011: 화면이 "요약이 낡았다" 를 판정하는 근거. 플래그가 아니라 두 시각을 그대로 준다 —
  // 파생값을 서버가 계산해 보내면 규칙이 두 군데로 갈라진다.
  transcriptEditedAt: r.transcript_edited_at ?? null,
  noteGeneratedAt: r.note_generated_at ?? null,
  createdAt: r.created_at,
})

export interface NewMeeting {
  userId: string
  /** 대상자. **없어도 된다** (016) — 내부 회의·거래처 조사. 값이 있으면 v2.customers 를 참조한다 */
  customerId: string | null
  title: string
  startTime: string
  endTime: string
  durationMinutes?: number | null
  notes?: string | null
  /** 분석 방식 (016). 모르는 값이면 general 로 떨어진다 */
  kind?: string | null
  /** 사건. **없어도 정상이다** — 수임 전 조사·자문 문의·내부 회의 */
  matterId?: string | null
}

/**
 * 조사을 만든다.
 *
 * 사내 원본과 달리 **여기서 분석을 시작하지 않는다.** 원본은 `autoAnalyze !== false` 면
 * 생성 직후 분석을 걸었는데, 화면은 녹음을 붙인 뒤 `POST /meetings/:id/analyze` 로 따로 건다.
 * 둘 다 돌면 같은 조사을 두 번 분석해 STT 비용이 두 배가 된다.
 *
 * `id`·`created_at` 은 넣지 않는다 — 스키마에 기본값이 있다.
 */
export async function createMeeting(db: pg.Client, m: NewMeeting): Promise<MeetingRow> {
  const row = await queryOne<MeetingRow>(db, `
    insert into v2.meetings
      (user_id, customer_id, title, start_time, end_time, duration_minutes,
       notes, kind, matter_id, privileged, analysis_status, analysis_progress)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8 = 'legal', 'pending', 0)
    returning id, user_id, customer_id, title, start_time, end_time, duration_minutes,
              audio_url, transcription, notes, kind, matter_id, privileged,
              analysis_status, analysis_progress,
              analysis_stage, analysis_error, analysis_note, created_at
  `, [
    m.userId, m.customerId, m.title,
    m.startTime, m.endTime, m.durationMinutes || 0, m.notes || null,
    // **모르는 값이 오면 general 이다.** 법률 분석을 잘못 거는 쪽이 더 나쁘다 (016).
    ['interrogation', 'witness', 'victim', 'interview', 'meeting'].includes(String(m.kind)) ? m.kind : 'interview',
    m.matterId || null,
  ])
  if (!row) throw new Error('meeting insert returned no row')
  return row
}

/**
 * 조사 목록.
 *
 * **관리자는 전부 본다.** 단건 조회(`getMeeting`)에는 처음부터 관리자 예외가 있었는데
 * 목록에만 없어서, 관리자로 로그인하면 **목록이 비어 있는데 링크로는 열리는** 상태가 됐다.
 * 관리 화면에서 남의 조사을 열 수 있으면서 목록에는 안 보이는 것은 앞뒤가 맞지 않는다.
 */
export async function listMeetings(
  db: pg.Client, userId: string, limit: number, offset: number, isAdmin = false,
) {
  // 관리자면 소유자 조건을 빼고, 아니면 자기 것만. 조건과 인자를 한 곳에서 맞춘다 —
  // 둘을 따로 쓰면 $1 자리가 어긋나 조용히 남의 것이 섞이거나 빈 목록이 나온다.
  const scope = isAdmin ? '' : 'and m.user_id = $3'
  const args = isAdmin ? [limit, offset] : [limit, offset, userId]
  const rows = await db.query<MeetingRow>(
    // **`kind`·`matter_id`·`privileged` 를 빠뜨리면 안 된다.** 매퍼가 `kind` 를
    // `?? 'general'` 로 메우기 때문에, 안 골라 오면 **조사이 목록에서 「일반」으로 보인다** —
    // 값이 비는 것이 아니라 **틀린 값이 나온다.** 2026-08-26 베타 점검에서 실제로 그랬다.
    `select m.id, m.user_id, m.customer_id, m.title, m.start_time, m.end_time,
            m.duration_minutes, m.audio_url, m.notes, m.analysis_status, m.analysis_progress,
            m.analysis_stage, m.analysis_error, m.analysis_note,
            m.kind, m.matter_id, m.privileged,
            m.created_at, c.company_name, (a.scores->>'overall') as overall_score
       from v2.meetings m
       left join v2.customers c on m.customer_id = c.id
       left join v2.analysis_results a on m.id = a.meeting_id
      where m.deleted_at is null ${scope}
      order by m.created_at desc limit $1 offset $2`, args)
  const count = isAdmin
    ? await queryOne<{ count: string }>(db,
        'select count(*) as count from v2.meetings where deleted_at is null')
    : await queryOne<{ count: string }>(db,
        'select count(*) as count from v2.meetings where user_id = $1 and deleted_at is null', [userId])
  return {
    meetings: rows.rows.map((r) => ({
      ...toMeeting(r),
      customerName: r.company_name || undefined,
      overallScore: r.overall_score != null ? parseInt(r.overall_score, 10) : undefined,
    })),
    total: Number(count?.count ?? 0),
  }
}

/** 소유자(또는 관리자)에게만. 아니면 null — 존재 여부도 알리지 않는다. */
export async function getMeeting(
  db: pg.Client, id: string, userId: string, isAdmin: boolean,
): Promise<MeetingRow | null> {
  return queryOne<MeetingRow>(db,
    `select id, user_id, customer_id, title, start_time, end_time, duration_minutes,
            audio_url, audio_duration_seconds, transcription, notes,
            analysis_status, analysis_progress, analysis_stage, analysis_error, analysis_note,
            analysis_started_at, transcript_edited_at, note_generated_at, created_at,
            kind, matter_id, privileged
       from v2.meetings
      where id = $1 and deleted_at is null
        and (
          user_id = $3
          -- **관리자 우회는 조사에 통하지 않는다** (021).
          --
          -- SEP 는 관리자가 전체를 본다. 영업에서는 그게 맞다 — 실적을 보려면 필요하다.
          -- **법률사무소에서는 그것이 위험이다.** 비닉권이 걸린 조사을 사건 담당자가 아닌
          -- 사람이 열 수 있으면, 그 사실 하나로 통제가 무너졌다고 볼 여지가 생긴다.
          --
          -- 일반·수임 조사은 SEP 동작 그대로 둔다. 좁히는 것은 위험한 쪽만이다.
          or ($2::boolean and kind <> 'legal')
        )`,
    [id, isAdmin, userId])
}

/**
 * 감사 기록 (021). **누가 언제 무엇을 열었는지 남긴다.**
 *
 * 증거개시 다툼에서 "이 기록은 통제된 범위에서만 열람됐다" 를 말하려면 근거가 있어야 한다.
 * **실패해도 던지지 않는다** — 감사 때문에 진료가 막히면 안 된다.
 * 다만 조용히 넘어가지도 않는다(호출부가 로그를 남긴다).
 */
export async function logAccess(db: pg.Client, e: {
  userId: string; userEmail?: string | null
  action: string; target: string; targetId?: string | null
  matterId?: string | null; detail?: unknown; ip?: string | null
}): Promise<void> {
  await db.query(
    `insert into v2.access_log (user_id, user_email, action, target, target_id, matter_id, detail, ip)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.userId, e.userEmail ?? null, e.action, e.target, e.targetId ?? null,
     e.matterId ?? null, e.detail ? JSON.stringify(e.detail) : null, e.ip ?? null])
}

export async function getAnalysis(db: pg.Client, meetingId: string) {
  const r = await queryOne<Record<string, unknown>>(db,
    `select id, meeting_id, customer_needs, deal_signals, scores, sentiment, key_points,
            summary, interests, concerns, action_items, follow_up_draft, talk_metrics,
            speaker_roles, psych_insights, coaching, scorecard, action_items_done, meeting_note, created_at
       from v2.analysis_results where meeting_id = $1`, [meetingId])
  if (!r) return null
  return {
    meetingId: r.meeting_id,
    customerNeeds: r.customer_needs,
    dealSignals: r.deal_signals,
    scores: r.scores,
    sentiment: r.sentiment,
    keyPoints: r.key_points,
    summary: r.summary || undefined,
    interests: r.interests || undefined,
    concerns: r.concerns || undefined,
    actionItems: r.action_items || undefined,
    followUpDraft: r.follow_up_draft || undefined,
    talkMetrics: r.talk_metrics || undefined,
    speakerRoles: r.speaker_roles || undefined,
    psychInsights: r.psych_insights || undefined,
    coaching: r.coaching || undefined,
    scorecard: r.scorecard || undefined,
    // 완료 체크. 항목 순번 배열이다.
    actionItemsDone: r.action_items_done || [],
    meetingNote: r.meeting_note || undefined,
    createdAt: r.created_at,
  }
}

export async function getSegments(db: pg.Client, meetingId: string) {
  const r = await db.query<{
    id: string; meeting_id: string; speaker_label: string; speaker_id: string | null
    content: string; start_ms: number | null; end_ms: number | null; sort_order: number
    content_original: string | null; edited_at: Date | null; highlights: unknown
    recording_id: string | null
  }>(`select id, meeting_id, speaker_label, speaker_id, content, start_ms, end_ms, sort_order,
             content_original, edited_at, highlights, recording_id
        from v2.transcript_segments where meeting_id = $1 order by sort_order asc`, [meetingId])
  return r.rows.map((s) => ({
    id: s.id,
    meetingId: s.meeting_id,
    speakerLabel: s.speaker_label,
    speakerId: s.speaker_id,
    content: s.content,
    startMs: s.start_ms,
    endMs: s.end_ms,
    sortOrder: s.sort_order,
    // 사람이 고친 줄인지, 원래 무엇이었는지. 화면이 표시와 되돌리기에 쓴다 (011).
    contentOriginal: s.content_original,
    editedAt: s.edited_at,
    highlights: Array.isArray(s.highlights) ? s.highlights : [],
    // 재생 위치의 근거 (012). 없으면 화면이 재생 이동 버튼을 감춘다 —
    // 어느 파일의 몇 초인지 모르는 채로 추측해 틀면 사용자가 그것을 믿는다.
    recordingId: s.recording_id,
  }))
}

export interface SegmentPatch { content?: string; highlights?: { start: number; end: number }[] }

/**
 * 녹취 한 줄을 고친다. **조사 소유자만.**
 *
 * `content_original` 은 처음 고칠 때만 채운다 — 두 번째 수정에서 덮으면
 * "AI 원문" 이 아니라 "직전 내 수정본" 이 되어 되돌릴 곳이 사라진다.
 *
 * 내용을 고치면 **그 줄의 형광펜은 비운다.** 글자가 바뀌면 오프셋이 어긋나는데,
 * 위치를 따라가려 들면 반드시 틀어진다 — 엉뚱한 곳이 칠해진 것보다 지워진 편이 낫다.
 */
export async function editSegment(
  db: pg.Client, meetingId: string, segmentId: string, userId: string, isAdmin: boolean,
  patch: SegmentPatch,
) {
  if (!await getMeeting(db, meetingId, userId, isAdmin)) return null

  const sets: string[] = []
  const vals: unknown[] = [segmentId, meetingId]
  if (typeof patch.content === 'string') {
    sets.push(`content_original = coalesce(content_original, content)`)
    sets.push(`content = $${vals.length + 1}`); vals.push(patch.content)
    sets.push(`highlights = '[]'::jsonb`)
    sets.push(`edited_at = now()`)
    sets.push(`edited_by = $${vals.length + 1}`); vals.push(userId)
  }
  if (Array.isArray(patch.highlights)) {
    sets.push(`highlights = $${vals.length + 1}::jsonb`)
    vals.push(JSON.stringify(patch.highlights))
  }
  if (!sets.length) return null

  const r = await db.query(
    `update v2.transcript_segments set ${sets.join(', ')}
      where id = $1 and meeting_id = $2 returning id`, vals)
  if (!r.rowCount) return null

  // 내용을 고쳤을 때만 "요약이 낡았다" 로 만든다. 형광펜은 요약과 무관하다.
  if (typeof patch.content === 'string') {
    await db.query('update v2.meetings set transcript_edited_at = now() where id = $1', [meetingId])
  }
  return getSegments(db, meetingId)
}

/** AI 원문으로 되돌린다. 원문이 없으면(=고친 적 없으면) 아무것도 하지 않는다. */
export async function revertSegment(
  db: pg.Client, meetingId: string, segmentId: string, userId: string, isAdmin: boolean,
) {
  if (!await getMeeting(db, meetingId, userId, isAdmin)) return null
  const r = await db.query(
    `update v2.transcript_segments
        set content = content_original, content_original = null,
            edited_at = null, edited_by = null, highlights = '[]'::jsonb
      where id = $1 and meeting_id = $2 and content_original is not null
      returning id`, [segmentId, meetingId])
  if (!r.rowCount) return null
  await db.query('update v2.meetings set transcript_edited_at = now() where id = $1', [meetingId])
  return getSegments(db, meetingId)
}

export async function updateMeeting(db: pg.Client, id: string, data: Record<string, unknown>) {
  const sets: string[] = []
  const vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  if (typeof data.title === 'string') put('title', data.title)
  if (typeof data.notes === 'string') put('notes', data.notes)
  if (typeof data.customerId === 'string') put('customer_id', data.customerId)
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  vals.push(id)
  await db.query(`update v2.meetings set ${sets.join(', ')} where id = $${vals.length}`, vals)
}

/**
 * **분석 결과만 지운다.** 조사·메모·녹음·녹취는 그대로 둔다.
 *
 * 왜 필요한가 (2026-08-20)
 *   녹음이 하나도 붙지 않은 조사이 제목과 메모만으로 분석돼 `overall 70` 과
 *   `analysis_status = 'completed'` 를 남겼다. 실패로 보이지 않고 **정상 기록처럼 보이는 것**이
 *   문제였다. 그렇다고 조사을 지우면 사람이 직접 쓴 메모까지 없어진다 —
 *   그 메모는 진짜 내용이고 유일본이다.
 *
 *   그래서 지우는 단위를 분석 결과 하나로 좁힌다. 상태는 `pending`(스키마 기본값)으로
 *   되돌려, 나중에 녹음을 붙여 다시 분석하면 그 자리에 정상 결과가 들어간다.
 *
 * **녹취(`transcript_segments`)는 건드리지 않는다.** 그것은 분석이 아니라 증거다.
 */
export async function clearAnalysis(db: pg.Client, meetingId: string) {
  const r = await db.query('delete from v2.analysis_results where meeting_id = $1', [meetingId])
  await db.query(
    `update v2.meetings
        set analysis_status = 'pending', analysis_progress = 0, analysis_stage = null,
            analysis_error = null, analysis_started_at = null, updated_at = now()
      where id = $1`, [meetingId])
  return r.rowCount ?? 0
}

export async function softDeleteMeeting(db: pg.Client, id: string) {
  const r = await db.query(
    'update v2.meetings set deleted_at = now() where id = $1 and deleted_at is null', [id])
  return (r.rowCount ?? 0) > 0
}

/**
 * 액션 아이템 완료 체크를 저장한다.
 *
 * **순번 배열이다.** 항목 텍스트가 아니라 인덱스라, 재분석으로 목록이 바뀌면 어긋난다.
 * 그래서 여기서는 현재 목록 길이를 넘는 값을 버린다 — 낡은 체크가 엉뚱한 항목에 붙는 것보다
 * 사라지는 편이 낫다.
 */
export async function setActionItemsDone(
  db: pg.Client, meetingId: string, done: number[],
): Promise<number[] | null> {
  const row = await queryOne<{ action_items: unknown }>(db,
    'select action_items from v2.analysis_results where meeting_id = $1', [meetingId])
  if (!row) return null
  const total = Array.isArray(row.action_items) ? row.action_items.length : 0
  const clean = [...new Set(done)]
    .filter((n) => Number.isInteger(n) && n >= 0 && n < total)
    .sort((a, b) => a - b)
  await db.query(
    'update v2.analysis_results set action_items_done = $2, updated_at = now() where meeting_id = $1',
    [meetingId, JSON.stringify(clean)])
  return clean
}
