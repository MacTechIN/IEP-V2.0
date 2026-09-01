// 끝난 상담을 사건에 붙이고 뗀다 (030)
//
// ── 왜 전용 경로인가 ──
//
// **붙이는 것은 칸 하나 바꾸는 일이 아니다.**
//
// 분석이 사건 없이 돌면 `legalPersist.ts` 는 원문과 findings 까지만 담고 멈춘다
// (`if (!matterId) { commit; return }`). 시계열·증거·요건사실은 **아예 만들어지지 않는다.**
// 그런데 서면은 정확히 그 셋으로 만든다.
//
// 그래서 `meetings.matter_id` 만 채우면 이렇게 된다:
//   화면 — 「사건에 붙었습니다」
//   서면 — 「요건사실이 없습니다 · 시계열이 없습니다」 … 영원히
// 붙지 않은 지금보다 나쁘다. **왜 안 되는지 알 수 없기 때문이다.**
//
// 그래서 붙이면서 **저장해 둔 분석 원문으로 파생 자료를 만든다.**
// 모델을 다시 부르지 않는다 — `legal_analyses.result` 에 그때 받은 JSON 이 그대로 있다.
// 돈이 들지 않고, 몇 번을 해도 같은 결과가 나온다.

import type pg from 'pg'
import { persistLegalAnalysis } from './legalPersist'
import type { LegalAnalysis } from './legalAnalysis'

export type AttachError =
  | { code: 'MEETING_NOT_FOUND' }
  | { code: 'MATTER_NOT_FOUND' }
  | { code: 'ALREADY_ATTACHED'; matterId: string; matterTitle: string }

export interface AttachResult {
  matterId: string
  matterTitle: string
  /** 파생 자료가 다시 만들어졌나. 법률 분석이 없는 상담이면 false 다. */
  rebuilt: boolean
  timeline: number
  evidence: number
  elementsTouched: number
  elementsKeptByHuman: number
  findings: number
  /** 사람이 읽을 안내. **조용히 넘어가는 것을 만들지 않는다.** */
  notes: string[]
}

/** 상담이 이 사람 것인가. 담당자 본인 또는 관리자만. */
async function ownedMeeting(
  db: pg.Client, meetingId: string, userId: string, isAdmin: boolean,
) {
  const r = await db.query<{
    id: string; kind: string; matter_id: string | null; customer_id: string | null; title: string
  }>(
    `select id, kind, matter_id, customer_id, title from v2.meetings
      where id = $1 and ($2 or user_id = $3)`,
    [meetingId, isAdmin, userId])
  return r.rows[0] ?? null
}

/**
 * 상담을 사건에 붙인다.
 *
 * **이미 다른 사건에 붙어 있으면 거절한다.** 조용히 옮기면 앞 사건에 이 상담이 만든
 * 시계열·증거가 남는데, 화면에는 옮긴 것처럼 보인다 — 두 사건이 같은 사실을 놓고
 * 서로 다른 자료를 갖게 된다. 떼는 것을 먼저 하게 한다.
 */
export async function attachMeetingToMatter(
  db: pg.Client, meetingId: string, matterId: string, userId: string, isAdmin: boolean,
): Promise<AttachResult | AttachError> {
  const mt = await ownedMeeting(db, meetingId, userId, isAdmin)
  if (!mt) return { code: 'MEETING_NOT_FOUND' }

  const mr = await db.query<{ id: string; title: string; cause: string | null; client_id: string | null }>(
    `select id, title, cause, client_id from v2.matters
      where id = $1 and ($2 or user_id = $3)`, [matterId, isAdmin, userId])
  const matter = mr.rows[0]
  if (!matter) return { code: 'MATTER_NOT_FOUND' }

  if (mt.matter_id && mt.matter_id !== matterId) {
    const prev = await db.query<{ title: string }>(
      'select title from v2.matters where id = $1', [mt.matter_id])
    return {
      code: 'ALREADY_ATTACHED',
      matterId: mt.matter_id,
      matterTitle: prev.rows[0]?.title ?? '(알 수 없는 사건)',
    }
  }

  const notes: string[] = []

  // 의뢰인이 다르면 **말해 준다.** 막지는 않는다 — 상담 상대와 사건 의뢰인이
  // 다른 경우가 실제로 있다(가족·법인 담당자). 다만 모르고 붙이면 안 된다.
  if (mt.customer_id && matter.client_id && mt.customer_id !== matter.client_id) {
    notes.push('이 상담의 상대와 사건의 의뢰인이 다릅니다 — 확인하십시오.')
  }
  if (!matter.cause) {
    notes.push('사건에 청구원인이 정해져 있지 않아 요건사실 목록을 만들 수 없습니다. '
             + '사건 화면에서 청구원인을 먼저 정하십시오.')
  }

  await db.query('update v2.meetings set matter_id = $2 where id = $1', [meetingId, matterId])

  // 이 상담의 분석 원문. 없으면 파생 자료를 만들 수 없다.
  const la = await db.query<{ result: LegalAnalysis; model: string | null; persona_rev: string | null }>(
    'select result, model, persona_rev from v2.legal_analyses where meeting_id = $1', [meetingId])

  if (!la.rowCount) {
    notes.push(mt.kind === 'legal'
      ? '이 상담은 아직 법률 분석이 없습니다. 분석을 돌리면 사건 자료가 채워집니다.'
      : '법률 상담이 아니라 사건 자료(시계열·증거·요건사실)는 만들어지지 않았습니다.')
    return {
      matterId, matterTitle: matter.title, rebuilt: false,
      timeline: 0, evidence: 0, elementsTouched: 0, elementsKeptByHuman: 0, findings: 0, notes,
    }
  }

  // **모델을 다시 부르지 않는다.** 그때 받은 JSON 을 그대로 흘려보낸다.
  const out = await persistLegalAnalysis(db, {
    meetingId, matterId,
    analysis: la.rows[0].result,
    model: la.rows[0].model ?? 'unknown',
    personaRev: la.rows[0].persona_rev ?? 'unknown',
  })

  if (out.elementsKeptByHuman > 0) {
    notes.push(`요건사실 ${out.elementsKeptByHuman}개는 사람이 정해 둔 것이라 그대로 뒀습니다.`)
  }

  return {
    matterId, matterTitle: matter.title, rebuilt: true,
    timeline: out.timeline, evidence: out.evidence,
    elementsTouched: out.elementsTouched, elementsKeptByHuman: out.elementsKeptByHuman,
    findings: out.findings, notes,
  }
}

export interface DetachResult {
  timelineRemoved: number
  evidenceRemoved: number
  notes: string[]
}

/**
 * 뗀다. **이 상담이 만든 것만 지운다** — `meeting_id` 로 정확히 가려낼 수 있다.
 *
 * 요건사실은 되돌리지 않는다. `legal_elements` 는 사건 단위로 **쌓이는** 표라
 * 여러 상담이 같은 칸을 덮어썼을 수 있고, 이 상담을 뺀 상태가 무엇인지 알 수 없다.
 * 지어서 되돌리느니 그대로 두고 **말해 준다.**
 */
export async function detachMeetingFromMatter(
  db: pg.Client, meetingId: string, userId: string, isAdmin: boolean,
): Promise<DetachResult | AttachError> {
  const mt = await ownedMeeting(db, meetingId, userId, isAdmin)
  if (!mt) return { code: 'MEETING_NOT_FOUND' }
  if (!mt.matter_id) return { timelineRemoved: 0, evidenceRemoved: 0, notes: ['이미 사건에 붙어 있지 않습니다.'] }

  await db.query('begin')
  try {
    const t = await db.query('delete from v2.timeline_events where meeting_id = $1', [meetingId])
    const e = await db.query('delete from v2.evidence where meeting_id = $1', [meetingId])
    await db.query('update v2.findings set matter_id = null where meeting_id = $1', [meetingId])
    await db.query('update v2.legal_analyses set matter_id = null where meeting_id = $1', [meetingId])
    await db.query('update v2.meetings set matter_id = null where id = $1', [meetingId])
    await db.query('commit')

    const notes = ['이 상담이 만든 시계열과 증거를 지웠습니다.']
    const el = await db.query<{ n: string }>(
      `select count(*)::text as n from v2.legal_elements
        where matter_id = $1 and updated_by_meeting = $2`, [mt.matter_id, meetingId])
    if (Number(el.rows[0]?.n ?? 0) > 0) {
      notes.push(`요건사실 ${el.rows[0].n}개는 이 상담이 마지막으로 고친 것입니다 — `
               + '되돌리지 않았습니다. 사건 화면에서 확인하십시오.')
    }
    return { timelineRemoved: t.rowCount ?? 0, evidenceRemoved: e.rowCount ?? 0, notes }
  } catch (err) {
    await db.query('rollback').catch(() => {})
    throw err
  }
}
