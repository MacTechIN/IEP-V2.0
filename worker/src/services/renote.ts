// 녹취를 고친 뒤 미팅노트와 AI 요약만 다시 만든다 (011).
//
// **왜 전체 재분석이 아닌가**
//   녹취 한 줄을 고쳤다고 코칭·스코어카드·심리 인사이트까지 다시 만들면,
//   보고 있던 결과가 통째로 달라진다. 사용자가 원한 것은 "틀린 글자를 고치는 것" 이지
//   "분석을 다시 받는 것" 이 아니다. 비용도 몇 배 든다.
//
// **무엇을 지켜야 하나**
//   특히 `action_items_done` 이다 — 사용자가 체크한 후속 조치다.
//   v1 에서 재분석이 이걸 날리던 것을 마이그레이션 0030 으로 고쳤는데,
//   여기서 되살리면 같은 사고를 v2 에서 반복하는 것이다.
//   그래서 **바꿀 컬럼을 명시적으로 두 개만 적는다.** `update ... set` 에 나열된 것 외에는
//   손이 닿지 않는다.

import type pg from 'pg'
import type { Env } from '../lib/env'
import { logLine } from '../lib/log'
import * as AI from './openai'

/** 재요약이 바꾸는 것 — 이 목록이 곧 계약이다. */
export const RENOTE_TOUCHES = ['analysis_results.meeting_note', 'analysis_results.summary'] as const

export interface RenoteResult {
  ok: boolean
  reason?: 'no_transcript' | 'no_meeting' | 'llm_failed'
  chars?: number
  topics?: number
}

/**
 * 고쳐진 녹취로 미팅노트와 요약을 다시 만든다.
 *
 * 녹취는 **세그먼트에서 다시 읽어 이어붙인다** — `meetings.transcription` 은
 * 전사 당시의 원문이라 수정이 반영돼 있지 않다.
 */
export async function renote(
  env: Env, db: pg.Client, meetingId: string, rid = '-',
): Promise<RenoteResult> {
  const m = (await db.query<{ id: string; title: string; notes: string | null }>(
    'select id, title, notes from v2.meetings where id = $1 and deleted_at is null',
    [meetingId])).rows[0]
  if (!m) return { ok: false, reason: 'no_meeting' }

  const segs = await db.query<{ content: string }>(
    `select content from v2.transcript_segments
      where meeting_id = $1 order by sort_order asc`, [meetingId])
  const transcription = segs.rows.map((s) => s.content || '').filter(Boolean).join('\n')
  if (!transcription.trim()) return { ok: false, reason: 'no_transcript' }

  logLine('info', 'renote.start', { rid, mid: meetingId, chars: transcription.length })

  // 둘을 함께 부른다 — 하나만 갱신되면 노트와 요약이 서로 다른 녹취를 근거로 삼게 된다.
  const [note, report] = await Promise.all([
    AI.generateMeetingNote(env, { id: m.id, title: m.title, notes: m.notes }, transcription),
    AI.generateReport(env, { id: m.id, title: m.title, notes: m.notes }, transcription),
  ])

  // **실패하면 아무것도 쓰지 않는다.** 기존 노트를 지우는 것이 갱신 실패보다 나쁘다.
  if (!note && !report?.summary) {
    logLine('warn', 'renote.failed', { rid, mid: meetingId })
    return { ok: false, reason: 'llm_failed' }
  }

  // 받은 것만 갱신한다. 한쪽이 실패했다고 다른 쪽까지 버리지 않는다.
  const sets: string[] = []
  const vals: unknown[] = [meetingId]
  if (note) { sets.push(`meeting_note = $${vals.length + 1}::jsonb`); vals.push(JSON.stringify(note)) }
  if (report?.summary) { sets.push(`summary = $${vals.length + 1}`); vals.push(report.summary) }
  sets.push('updated_at = now()')

  await db.query(
    `update v2.analysis_results set ${sets.join(', ')} where meeting_id = $1`, vals)
  await db.query('update v2.meetings set note_generated_at = now() where id = $1', [meetingId])

  logLine('info', 'renote.done', {
    rid, mid: meetingId, chars: transcription.length,
    topics: note?.topics?.length ?? 0, summary: report?.summary ? 1 : 0,
  })
  return { ok: true, chars: transcription.length, topics: note?.topics?.length ?? 0 }
}
