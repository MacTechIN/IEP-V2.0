// 법률 분석 결과를 표에 나눠 담는다 (018)
//
// `legalAnalysis.ts` 가 모델에게서 받은 JSON 하나를 여섯 갈래로 흘려보낸다.
//
//   legal_analyses    원문 그대로        ← 정규화한 표만 두면 모델이 뭐라 했는지 사라진다
//   legal_elements    요건 충족 상태     ← **사건 단위로 쌓인다**
//   findings          누락·모순·불리     ← 상담 단위
//   timeline_events   시계열             ← 사건 단위
//   evidence          증거와 난이도      ← 사건 단위, 상태가 변한다
//
// **누락(GAP)은 모델에게 묻지 않고 계산한다.**
//   우리는 그 사건의 요건 목록을 갖고 있다(`element_templates`). 모델이 채우지 못한 것이
//   곧 누락이다. "빠진 게 뭐냐" 고 물으면 모델이 지어내지만, 대조하면 지어낼 수 없다.

import type pg from 'pg'
import type { LegalAnalysis } from './legalAnalysis'

export interface PersistInput {
  meetingId: string
  matterId: string | null
  analysis: LegalAnalysis
  model: string
  personaRev: string
}

export interface PersistResult {
  facts: number
  findings: number
  timeline: number
  evidence: number
  elementsTouched: number
  /** 사람이 정해 둬서 **AI 가 손대지 않은** 요건 수 (025) */
  elementsKeptByHuman: number
  gapsComputed: number
}

/** 사건의 요건 목록. 없으면 빈 배열 — 청구원인이 안 정해진 사건도 있다. */
export async function elementChecklist(
  db: pg.Client, matterId: string | null,
): Promise<{ cause: string; element: string; hint: string | null }[]> {
  if (!matterId) return []
  const r = await db.query<{ cause: string; element: string; hint: string | null }>(
    `select t.cause, t.element, t.hint
       from v2.matters m
       join v2.element_templates t
         on t.cause = m.cause and (t.user_id is null or t.user_id = m.user_id)
      where m.id = $1
      order by t.sort_order asc`, [matterId])
  return r.rows
}

/**
 * 결과를 표에 담는다. **한 트랜잭션이다** — 절반만 들어가면 화면이 거짓을 보여 준다.
 *
 * 상담 단위(원문·findings)는 **다시 분석하면 갈아엎는다.**
 * 사건 단위(요건·타임라인·증거)는 **쌓는다** — 2회 상담이 1회의 빈 요건을 채우는 것이
 * 이 제품의 값이므로, 다시 분석했다고 앞선 상담의 결과를 지우면 안 된다.
 */
export async function persistLegalAnalysis(
  db: pg.Client, input: PersistInput,
): Promise<PersistResult> {
  const { meetingId, matterId, analysis, model, personaRev } = input
  const out: PersistResult = {
    facts: analysis.chronological_facts?.length ?? 0,
    findings: 0, timeline: 0, evidence: 0, elementsTouched: 0, elementsKeptByHuman: 0, gapsComputed: 0,
  }

  await db.query('begin')
  try {
    // ── 원문. 같은 상담을 다시 분석하면 덮는다.
    await db.query(
      `insert into v2.legal_analyses (meeting_id, matter_id, result, model, persona_rev)
       values ($1,$2,$3,$4,$5)
       on conflict (meeting_id) do update
         set result = excluded.result, model = excluded.model,
             persona_rev = excluded.persona_rev, created_at = now(),
             -- **사건도 함께 옮긴다.** 나중에 사건에 붙일 때 이 함수를 다시 부르는데(030),
             -- 여기서 matter_id 를 빼 두면 원문만 사건 밖에 남아 자료가 갈린다.
             matter_id = excluded.matter_id`,
      [meetingId, matterId, JSON.stringify(analysis), model, personaRev])

    // ── findings. **이 상담에서 나온 것**이라 다시 분석하면 갈아엎는다.
    await db.query('delete from v2.findings where meeting_id = $1', [meetingId])
    for (const f of analysis.risk_and_gaps ?? []) {
      // 모순인데 가리키는 것이 둘 미만이면 담지 않는다. DB 제약이 막지만,
      // 여기서 걸러야 **왜 사라졌는지** 로그에 남는다.
      if (f.kind === 'INCONSISTENCY' && (f.refs?.length ?? 0) < 2) continue
      await db.query(
        `insert into v2.findings (meeting_id, matter_id, kind, severity, detail, refs, question)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [meetingId, matterId, f.kind, f.severity, f.detail,
         JSON.stringify(f.refs ?? []), f.question ?? null])
      out.findings++
    }

    // 사건이 없으면 여기까지다 — 요건·타임라인·증거는 사건에 붙는다.
    if (!matterId) { await db.query('commit'); return out }

    // ── 타임라인. **이 상담에서 나온 것만** 갈아엎고 다른 상담 것은 둔다.
    await db.query('delete from v2.timeline_events where meeting_id = $1', [meetingId])
    for (const t of analysis.chronological_facts ?? []) {
      const on = /^\d{4}-\d{2}-\d{2}$/.test(t.occurred_on || '') ? t.occurred_on : null
      await db.query(
        `insert into v2.timeline_events
           (matter_id, meeting_id, occurred_on, precision, what, legal_meaning, actors)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [matterId, meetingId, on, t.precision || 'UNKNOWN', t.fact,
         t.legal_meaning || null, JSON.stringify(t.actors ?? [])])
      out.timeline++
    }

    // ── 증거. **상태가 변하는 표다** — 사람이 `SECURED` 로 올려 둔 것을 덮으면 안 된다.
    // 같은 상담에서 나온 것만 갈아엎는다.
    await db.query('delete from v2.evidence where meeting_id = $1', [meetingId])
    for (const t of analysis.chronological_facts ?? []) {
      const e = t.evidence
      if (!e?.kind) continue
      await db.query(
        `insert into v2.evidence
           (matter_id, meeting_id, kind, what, status, holder, difficulty, proves)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [matterId, meetingId, e.kind, t.fact, e.status || 'UNCONFIRMED',
         e.holder || null,
         Number.isInteger(e.difficulty) && e.difficulty >= 1 && e.difficulty <= 5
           ? e.difficulty : null,
         t.legal_meaning || null])
      out.evidence++
    }

    // ── 요건. **쌓는다.** 모델이 채운 것만 올리고, 나머지는 건드리지 않는다 —
    // 1회 상담에서 SATISFIED 가 된 요건을 2회 상담이 MISSING 으로 되돌리면 안 된다.
    const byName = new Map<string, { status: string; note: string }>()
    for (const el of analysis.legal_elements ?? []) {
      if (!el.element) continue
      byName.set(el.element, { status: el.status || 'MISSING', note: el.note || '' })
    }

    const list = await elementChecklist(db, matterId)
    for (const t of list) {
      const got = byName.get(t.element)
      // 이 상담에서 다루지 않은 요건은 **그대로 둔다.** 앞선 상담의 상태가 살아 있어야 한다.
      if (!got || got.status === 'MISSING') { out.gapsComputed++; continue }
      // **사람이 정한 것은 덮지 않는다** (025). 변호사가 손으로 바꾼 판단이
      // 다음 분석에서 조용히 사라지면, 바꿔 놓은 사람은 그대로 있다고 믿는다.
      // v1 이 `action_items_done` 에서 같은 사고를 냈다.
      const r = await db.query(
        `insert into v2.legal_elements (matter_id, cause, element, status, note, updated_by_meeting)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (matter_id, cause, element) do update
           set status = excluded.status, note = excluded.note,
               updated_by_meeting = excluded.updated_by_meeting, updated_at = now()
         where v2.legal_elements.set_by <> 'human'`,
        [matterId, t.cause, t.element, got.status, got.note, meetingId])
      if (r.rowCount) out.elementsTouched++
      else out.elementsKeptByHuman++
    }

    await db.query('commit')
    return out
  } catch (e) {
    await db.query('rollback').catch(() => {})
    throw e
  }
}
