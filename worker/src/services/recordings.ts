// 녹음(draft) — 사내 백엔드 services/recordingService.ts 이관분 (C-5-4)
//
// 저장 위치가 로컬 디스크에서 R2 로 바뀐다. 키는 `recordings/<id><확장자>` —
// C-4b 에서 옮겨 둔 기존 18개와 같은 규칙이라 옛 파일도 그대로 열린다.
//
// **전사는 업로드 요청 밖에서 돈다** (2026-08-11, 마이그레이션 010).
//   예전에는 `createDraft` 가 요청 안에서 STT 를 기다렸다 — 10분짜리 하나에 실측 188초.
//   순서가 R2 저장 → STT → DB insert 였으므로 그 188초의 대부분이 "파일은 있고 행은 없는" 구간이었고,
//   거기서 끊긴 것이 회수한 고아 객체 4개다. 지금은 업로드가 저장과 insert 만 하고
//   전사는 TranscribeWorkflow 가 맡는다 — 그 구간이 count 한 번과 insert 한 번으로 줄어든다.
//
//   전사 자체를 옮긴 것이지 없앤 것이 아니다. 결과는 같은 컬럼에 같은 형태로 들어간다.

import type pg from 'pg'
import type { Env } from '../lib/env'
import { queryOne, withDb } from '../lib/db'
import { logLine, stopwatch } from '../lib/log'
import { toKnownSpeakers } from '../lib/voice'
import * as U from './users'
import * as AI from './openai'

export interface RecordingRow {
  id: string; label: string | null; duration_seconds: number | null
  transcription: string | null; selected: boolean; sort_order: number
  transcribe_status: string
  transcribe_notes?: Record<string, unknown> | null
}

export const toRecording = (r: RecordingRow) => ({
  id: r.id,
  label: r.label,
  durationSeconds: r.duration_seconds,
  transcription: r.transcription,
  selected: r.selected,
  sortOrder: r.sort_order,
  // 화면이 "전사 중" 과 "전사 실패" 를 구분할 수 있어야 한다. 예전에는 둘 다 빈 문자열이었다.
  transcribeStatus: r.transcribe_status,
  // **`done` 이어도 등급이 내려갔을 수 있다** (014). 화면이 그걸 말할 수 있어야 한다.
  transcribeNotes: r.transcribe_notes ?? null,
})

const COLS = 'id, label, duration_seconds, transcription, selected, sort_order, transcribe_status,\n  transcribe_notes'

export async function listDrafts(db: pg.Client, userId: string) {
  const r = await db.query<RecordingRow>(
    `select ${COLS} from v2.meeting_recordings
      where user_id = $1 and meeting_id is null order by sort_order asc`, [userId])
  return r.rows.map(toRecording)
}

/**
 * 업로드 → R2 저장 → draft 행 생성. **전사는 하지 않는다.**
 *
 * 전사는 이 요청이 끝난 뒤 TranscribeWorkflow 가 맡는다. 그래서 여기 남는 위험 구간은
 * `upload.r2` 와 `upload.done` 사이 — count 한 번과 insert 한 번뿐이다.
 * 예전에는 그 사이에 STT 와 화자 판정이 통째로 들어 있었고, 10분 파일 기준 요청 전체가 188초였다.
 *
 * 실제 폭이 얼마나 줄었는지는 두 로그의 `ms` 로 확인할 수 있다 — 그러라고 남기는 값이다.
 */
export async function createDraft(
  env: Env, userId: string, audio: File, label: string | null, durationSeconds: number | null,
  rid = '-',
) {
  const ext = (audio.name.match(/\.[a-z0-9]+$/i)?.[0] || '.audio').toLowerCase()

  // id 를 먼저 정한다 — R2 키가 id 기반이라 저장 전에 필요하다
  const id = crypto.randomUUID()
  const key = `recordings/${id}${ext}`
  if (!env.UPLOADS) throw new Error('R2 바인딩이 없습니다')

  const sw = stopwatch()
  logLine('info', 'upload.start', { rid, id, bytes: audio.size, ext })

  // File 을 그대로 넘긴다. 예전에는 `arrayBuffer()` 로 읽고 그 사본으로 Blob 을 또 만들었는데 —
  // 같은 바이트를 STT 에도 써야 했기 때문이다 — 그러면 100MB 파일이 메모리에 두 번 올라간다.
  // Worker 의 메모리 한도가 128MB 라 그것만으로도 위험했다. 전사가 빠지면서 필요가 없어졌다.
  // (스트림이 아니라 Blob 인 이유: 길이가 알려져 있어야 R2 가 한 번에 쓴다)
  await env.UPLOADS.put(key, audio, {
    httpMetadata: { contentType: audio.type || 'application/octet-stream' },
  })
  // 이 줄이 있는데 `upload.done` 이 없으면 = R2 에만 있는 고아다. 그것만으로 판정할 수 있다.
  logLine('info', 'upload.r2', { rid, id, key, ms: sw.mark() })

  const rec = await withDb(env, async (db) => {
    const cnt = await queryOne<{ count: string }>(db,
      'select count(*) as count from v2.meeting_recordings where user_id = $1 and meeting_id is null',
      [userId])
    const sortOrder = Number(cnt?.count ?? 0)
    const row = await queryOne<RecordingRow>(db,
      `insert into v2.meeting_recordings
         (id, user_id, label, storage_path, duration_seconds, transcription, segments,
          selected, sort_order, transcribe_status)
       values ($1,$2,$3,$4,$5,null,'[]'::jsonb,true,$6,'pending')
       returning ${COLS}`,
      [id, userId, label || `녹음 ${sortOrder + 1}`, key, durationSeconds, sortOrder])
    // 여기까지 오면 R2 와 DB 가 짝을 이룬 것이다. 이 줄이 없으면 고아다.
    logLine('info', 'upload.done', { rid, id, sort: sortOrder, dbMs: sw.mark(), totalMs: sw.total() })
    return row ? toRecording(row) : null
  })

  // 전사를 띄운다. **실패해도 업로드는 성공이다** — 파일과 행은 이미 짝을 이뤘고,
  // 밀린 전사는 분석 시작 때 보정 경로가 다시 집는다.
  if (rec) await startTranscription(env, id, rid)
  return rec
}

/** 전사 Workflow 를 띄운다. 바인딩이 없거나 기동에 실패해도 던지지 않는다. */
export async function startTranscription(env: Env, recordingId: string, rid = '-') {
  if (!env.TRANSCRIBE) {
    logLine('warn', 'transcribe.nobinding', { rid, id: recordingId })
    return null
  }
  try {
    const inst = await env.TRANSCRIBE.create({ params: { recordingId } })
    logLine('info', 'transcribe.queued', { rid, id: recordingId, wf: inst.id })
    return inst.id
  } catch (e) {
    logLine('error', 'transcribe.queue_failed', {
      rid, id: recordingId, err: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/** 이 이상 실패하면 자동으로 다시 집지 않는다. 사용자가 지우고 다시 올리는 편이 빠르다. */
export const MAX_TRANSCRIBE_TRIES = 3

/**
 * 이만큼 'processing' 인 채로 있으면 죽은 것으로 보고 회수한다.
 *
 * 20분인 이유: STT 입력 한도가 오디오 23분 20초이고, 실측이 10분에 188초다.
 * 가장 긴 입력이라도 그 절반 안에 끝난다. 짧게 잡으면 **돌고 있는 전사를 뺏어**
 * 같은 오디오에 STT 비용을 두 번 낸다 — 늦게 회수하는 쪽이 싸다.
 */
const STALE_PROCESSING = '20 minutes'

export type TranscribeOutcome =
  | { status: 'done'; chars: number; segs: number }
  /** 이미 전사돼 있다 */
  | { status: 'skipped'; chars: number }
  /** 다른 쪽이 집어갔다(잠금 실패) 또는 시도 한도를 넘겼다 */
  | { status: 'busy' | 'exhausted' }
  | { status: 'failed'; error: string }

/**
 * 녹음 하나를 전사해 같은 행에 채운다.
 *
 * **잠금을 먼저 잡는다.** 전사 Workflow 와 분석의 보정 경로가 같은 녹음을 동시에 집으면
 * STT 비용을 두 번 낸다(20분 오디오 기준 회당 $1.27). 조건부 update 를 이긴 쪽만 진행하고,
 * 진 쪽은 'busy' 를 받아 기다린다 — v1 의 claimAnalysis 와 같은 방식이다.
 */
export async function transcribeRecording(
  env: Env, recordingId: string, rid = '-',
): Promise<TranscribeOutcome> {
  const sw = stopwatch()

  const claimed = await withDb(env, (db) => queryOne<{
    storage_path: string | null; user_id: string; transcribe_tries: number
  }>(db,
    `update v2.meeting_recordings
        set transcribe_status     = 'processing',
            transcribe_tries      = transcribe_tries + 1,
            transcribe_error      = null,
            transcribe_started_at = now()
      where id = $1
        and transcribe_tries < $2
        and (
          transcribe_status in ('pending', 'failed')
          -- 오래 잡고 있으면 죽은 것으로 본다. 이 줄이 없으면 잠금이 영구히 남는다.
          or (transcribe_status = 'processing'
              and coalesce(transcribe_started_at, to_timestamp(0)) < now() - $3::interval)
        )
      returning storage_path, user_id, transcribe_tries`,
    [recordingId, MAX_TRANSCRIBE_TRIES, STALE_PROCESSING]))

  if (!claimed) {
    // 왜 못 잡았는지 구분해 준다 — 이미 끝난 것과 남이 잡은 것과 한도 초과는 대응이 다르다.
    const cur = await withDb(env, (db) => queryOne<{
      transcribe_status: string; transcribe_tries: number; chars: number
    }>(db,
      `select transcribe_status, transcribe_tries, coalesce(length(transcription), 0) as chars
         from v2.meeting_recordings where id = $1`, [recordingId]))
    if (!cur) return { status: 'failed', error: '녹음을 찾을 수 없습니다' }
    if (cur.transcribe_status === 'done') return { status: 'skipped', chars: Number(cur.chars) }
    // **순서가 중요하다.** 남이 돌고 있는데 시도 횟수만 보고 'exhausted' 를 주면,
    // 곧 끝날 전사를 기다리지 않고 분석이 전사문 없이 진행된다.
    if (cur.transcribe_status === 'processing') return { status: 'busy' }
    if (cur.transcribe_tries >= MAX_TRANSCRIBE_TRIES) return { status: 'exhausted' }
    return { status: 'busy' }
  }

  logLine('info', 'transcribe.start', {
    rid, id: recordingId, key: claimed.storage_path, try: claimed.transcribe_tries,
  })

  try {
    if (!claimed.storage_path) throw new Error('저장 경로가 없습니다')
    // 옛 데이터는 사내 서버의 로컬 경로다. R2 에 없으므로 여기서 다룰 수 없다.
    if (claimed.storage_path.startsWith('/')) throw new Error('R2 밖의 옛 경로입니다')

    const obj = await env.UPLOADS?.get(claimed.storage_path)
    if (!obj) throw new Error(`R2 에 객체가 없습니다: ${claimed.storage_path}`)
    const blob = await obj.blob()
    const name = claimed.storage_path.split('/').pop() || 'audio'
    logLine('info', 'transcribe.fetched', { rid, id: recordingId, bytes: blob.size, ms: sw.mark() })

    // 올린 사람의 목소리가 등록돼 있으면 함께 보낸다 — 본인 발화에만 실명이 붙는다.
    const known = await withDb(env, async (db) =>
      toKnownSpeakers(env, [await U.getEnrollment(db, claimed.user_id)]))

    const stt = await AI.transcribeAudio(env, blob, name, known)
    // **글자 수만 남긴다. 전사 내용은 로그에 넣지 않는다.**
    logLine(stt?.text ? 'info' : 'warn', 'transcribe.stt', {
      rid, id: recordingId, chars: stt?.text?.length ?? 0, segs: stt?.segments?.length ?? 0,
      ms: sw.mark(),
    })
    if (!stt?.text) throw new Error('전사 결과가 비어 있습니다')

    const roles = await AI.mapSpeakerRoles(env, stt.segments)
    // 등록한 목소리는 STT 가 화자 ID 자리에 **실명**을 넣어 준다.
    // 거기에 "화자 " 를 덧붙이면 '화자 관리자' 가 된다 — 실명은 실명 그대로 쓴다.
    const enrolled = new Set(known.map((k) => k.name))
    // **원래 화자 ID 를 함께 남긴다.** 역할·실명으로 덮고 나면 파트1 의 A 와 파트5 의 A 가
    // 같은 이름이 되어 구분할 수 없다 — 구간 경계 격리가 이 값에 기댄다 (2026-08-20).
    const segments = stt.segments.map((s) => ({
      speaker: enrolled.has(s.speaker) ? s.speaker : (roles[s.speaker] || `화자 ${s.speaker}`),
      speaker_raw: s.speaker,
      start_ms: s.start_ms, end_ms: s.end_ms, text: s.text,
    }))
    logLine('info', 'transcribe.roles', {
      rid, id: recordingId, speakers: Object.keys(roles).length, ms: sw.mark(),
    })

    await withDb(env, (db) => db.query(
      `update v2.meeting_recordings
          set transcription = $2, segments = $3, transcribe_notes = $4,
              transcribe_status = 'done', transcribe_error = null, transcribed_at = now()
        where id = $1`,
      [recordingId, stt.text, JSON.stringify(segments), JSON.stringify(stt.notes)]))
    // **등급이 내려갔으면 성공 로그에도 그렇게 적는다.** `done` 만 남기면 조사할 때
    // 이 줄이 정상으로 읽힌다 — 그게 2026-08-20 에 원인을 좁히지 못한 이유다.
    const degraded = stt.notes.engine === 'whisper'
      || (stt.notes.enrolled > 0 && stt.notes.matched === 0)
    logLine(degraded ? 'warn' : 'info', degraded ? 'transcribe.done_degraded' : 'transcribe.done', {
      rid, id: recordingId, chars: stt.text.length, segs: segments.length,
      engine: stt.notes.engine, enrolled: stt.notes.enrolled, matched: stt.notes.matched,
      attempts: stt.notes.attempts, totalMs: sw.total(),
    })
    return { status: 'done', chars: stt.text.length, segs: segments.length }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    // 잠금을 풀어 준다. 풀지 않으면 'processing' 인 채로 남아 아무도 다시 집지 못한다.
    await withDb(env, (db) => db.query(
      `update v2.meeting_recordings
          set transcribe_status = 'failed', transcribe_error = $2 where id = $1`,
      [recordingId, error.slice(0, 500)])).catch(() => {})
    logLine('error', 'transcribe.failed', { rid, id: recordingId, err: error, totalMs: sw.total() })
    return { status: 'failed', error }
  }
}

export async function updateRecording(
  db: pg.Client, id: string, userId: string, data: { label?: unknown; selected?: unknown },
) {
  const sets: string[] = []
  const vals: unknown[] = []
  if (typeof data.label === 'string') { sets.push(`label = $${sets.length + 1}`); vals.push(data.label) }
  if (typeof data.selected === 'boolean') { sets.push(`selected = $${sets.length + 1}`); vals.push(data.selected) }
  if (!sets.length) return null
  vals.push(id, userId)
  await db.query(
    `update v2.meeting_recordings set ${sets.join(', ')}
      where id = $${vals.length - 1} and user_id = $${vals.length}`, vals)
  const row = await queryOne<RecordingRow>(db,
    `select ${COLS} from v2.meeting_recordings where id = $1 and user_id = $2`, [id, userId])
  return row ? toRecording(row) : null
}

/**
 * 한 미팅에 붙은 녹음 목록 (012). 재생기가 고를 수 있어야 한다.
 *
 * `listDrafts` 와 달리 **미팅에 붙은 것**을 본다 — 저쪽은 아직 안 붙은 draft 다.
 */
export async function listMeetingRecordings(db: pg.Client, meetingId: string) {
  const r = await db.query<RecordingRow>(
    `select ${COLS} from v2.meeting_recordings
      where meeting_id = $1 order by sort_order asc`, [meetingId])
  return r.rows.map(toRecording)
}

/**
 * 녹음 오디오를 흘려보낸다 (012).
 *
 * **스트림을 그대로 넘긴다.** `arrayBuffer()` 로 읽으면 15MB 짜리가 통째로 메모리에 올라가고,
 * Worker 한도는 128MB 다 — 동시 재생 몇 건이면 넘어간다.
 *
 * **Range 를 지원한다.** 실측 녹음 중앙값이 14.7MB 라, 없으면 재생 버튼을 누르고
 * 전부 받을 때까지 기다려야 하고 뒤로 감으면 처음부터 다시 받는다.
 * R2 의 `get` 이 `Headers` 를 그대로 받으므로 브라우저가 보낸 것을 넘기면 된다.
 *
 * 소유자(또는 관리자)가 아니면 **null** — 존재 여부도 알리지 않는다.
 */
export async function getRecordingAudio(
  env: Env, db: pg.Client, id: string, userId: string, isAdmin: boolean,
  rangeHeader: string | null,
): Promise<Response | null> {
  const row = await queryOne<{ storage_path: string | null; label: string | null }>(db,
    `select storage_path, label from v2.meeting_recordings
      where id = $1 and ($2::boolean or user_id = $3)`, [id, isAdmin, userId])
  if (!row?.storage_path) return null
  // 옛 데이터는 사내 서버의 로컬 경로다. R2 에 없다.
  if (row.storage_path.startsWith('/')) return null
  if (!env.UPLOADS) return null

  const opts = rangeHeader ? { range: new Headers({ range: rangeHeader }) } : undefined
  const obj = await env.UPLOADS.get(row.storage_path, opts)
  if (!obj) return null

  const type = obj.httpMetadata?.contentType || 'audio/webm'
  const h = new Headers({
    'Content-Type': type,
    // 이게 없으면 브라우저가 Range 를 아예 시도하지 않는다 — 구간 이동이 안 된다.
    'Accept-Ranges': 'bytes',
    // 사적인 음성이다. 중간 캐시에 남기지 않는다.
    'Cache-Control': 'private, max-age=3600',
  })

  // `range` 가 있으면 부분 응답이다. 없는 경우(요청 범위가 전체를 덮을 때)도 있으므로
  // 헤더가 아니라 **R2 가 실제로 무엇을 돌려줬는지**로 판정한다.
  const r = (obj as { range?: { offset: number; length: number } }).range
  if (rangeHeader && r) {
    const start = r.offset
    const end = r.offset + r.length - 1
    h.set('Content-Range', `bytes ${start}-${end}/${obj.size}`)
    h.set('Content-Length', String(r.length))
    return new Response((obj as R2ObjectBody).body, { status: 206, headers: h })
  }
  h.set('Content-Length', String(obj.size))
  return new Response((obj as R2ObjectBody).body, { status: 200, headers: h })
}

/** 행을 지우고 **R2 객체도 지운다.** 원본은 로컬 파일을 unlink 했다. */
export async function removeRecording(env: Env, db: pg.Client, id: string, userId: string) {
  const row = await queryOne<{ storage_path: string | null }>(db,
    'select storage_path from v2.meeting_recordings where id = $1 and user_id = $2', [id, userId])
  if (!row) return false
  const r = await db.query('delete from v2.meeting_recordings where id = $1 and user_id = $2', [id, userId])
  // 로컬 경로(옛 데이터)면 R2 에 없으므로 삭제를 시도하지 않는다
  if (row.storage_path && !row.storage_path.startsWith('/')) {
    await env.UPLOADS?.delete(row.storage_path).catch(() => {})
  }
  return (r.rowCount ?? 0) > 0
}

/** 선택한 녹음을 미팅에 붙인다. 소유자 것만. */
export async function attachRecordings(
  db: pg.Client, meetingId: string, recordingIds: string[], userId: string,
) {
  if (!recordingIds.length) return 0
  const r = await db.query(
    'update v2.meeting_recordings set meeting_id = $1 where id = any($2::uuid[]) and user_id = $3',
    [meetingId, recordingIds, userId])
  return r.rowCount ?? 0
}
