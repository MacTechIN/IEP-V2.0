// 사건 (016·017·018·022)
//
// **사건은 담당자만 본다.** 관리자 우회가 없다.
//
//   미팅은 종류에 따라 갈렸다(`legal` 만 좁힘). 사건은 그럴 필요가 없다 —
//   사건 자체가 법률 업무이고 `privileged` 가 기본 참이다.
//   여기서 관리자에게 열어 두면 021 에서 미팅을 좁힌 의미가 없어진다.

import type pg from 'pg'
import { queryOne } from '../lib/db'

export interface MatterRow {
  id: string; user_id: string; client_id: string | null
  title: string; file_no: string | null; court_case_no: string | null
  matter_type: string | null; cause: string | null; court: string | null
  status: string; opened_on: string | null; closed_on: string | null
  retention_years: number | null; privileged: boolean
  notes: string | null; created_at: string; updated_at: string
  client_name?: string | null
}

export const toMatter = (r: MatterRow) => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name ?? null,
  title: r.title,
  fileNo: r.file_no,
  courtCaseNo: r.court_case_no,
  matterType: r.matter_type,
  cause: r.cause,
  court: r.court,
  status: r.status,
  openedOn: r.opened_on,
  closedOn: r.closed_on,
  retentionYears: r.retention_years,
  privileged: r.privileged,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const COLS = `m.id, m.user_id, m.client_id, m.title, m.file_no, m.court_case_no,
              m.matter_type, m.cause, m.court, m.status, m.opened_on, m.closed_on,
              m.retention_years, m.privileged, m.notes, m.created_at, m.updated_at,
              c.company_name as client_name`

/**
 * 이름 표기 흔들림을 없앤다 — `주식회사 가나` · `㈜가나` · `가나(주)` 가 같은 값이 된다.
 *
 * **이해충돌 검사가 이 함수에 달려 있다.** 표기가 다르다고 못 찾으면
 * 검사를 안 한 것과 같고, 그건 수임 자체가 문제가 되는 종류다.
 */
export function normalizeName(name: string): string {
  return (name || '')
    // **괄호 꼴을 먼저 통째로 지운다.** 괄호만 벗기면 `다라(주)` 가 `다라주` 가 되어
    // `주식회사 다라` 와 다른 값이 된다 — 실제로 그렇게 못 찾았다 (2026-08-26).
    .replace(/\(\s*[주유재사]\s*\)/g, '')
    .replace(/（\s*[주유재사]\s*）/g, '')
    .replace(/주식회사|유한회사|유한책임회사|합자회사|합명회사|재단법인|사단법인/g, '')
    .replace(/[㈜㈔㈐()（）\s.,\-_·]/g, '')
    .toLowerCase()
    .trim()
}

export async function listMatters(db: pg.Client, userId: string, status?: string) {
  const r = await db.query<MatterRow>(
    `select ${COLS} from v2.matters m
       left join v2.customers c on c.id = m.client_id
      where m.user_id = $1 and ($2::text is null or m.status = $2)
      order by m.updated_at desc limit 200`, [userId, status ?? null])
  return r.rows.map(toMatter)
}

/** **담당자만.** 관리자 우회를 두지 않는다 (021 과 같은 이유). */
export async function getMatter(db: pg.Client, id: string, userId: string) {
  return queryOne<MatterRow>(db,
    `select ${COLS} from v2.matters m
       left join v2.customers c on c.id = m.client_id
      where m.id = $1 and m.user_id = $2`, [id, userId])
}

export async function createMatter(db: pg.Client, m: {
  userId: string; clientId?: string | null; title: string
  fileNo?: string | null; courtCaseNo?: string | null
  matterType?: string | null; cause?: string | null; court?: string | null
  openedOn?: string | null; notes?: string | null
}) {
  const row = await queryOne<{ id: string }>(db,
    `insert into v2.matters
       (user_id, client_id, title, file_no, court_case_no, matter_type, cause, court,
        opened_on, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [m.userId, m.clientId || null, m.title, m.fileNo || null, m.courtCaseNo || null,
     m.matterType || null, m.cause || null, m.court || null, m.openedOn || null, m.notes || null])
  if (!row) throw new Error('matter insert returned no row')

  // 청구원인이 정해져 있으면 **요건 체크리스트를 곧바로 깐다** (018).
  // 사건을 만든 직후에 "무엇을 확인해야 하는지" 가 보여야 첫 상담을 준비할 수 있다.
  if (m.cause) await db.query('select v2.seed_legal_elements($1, $2)', [row.id, m.cause])
  return row.id
}

export async function updateMatter(db: pg.Client, id: string, userId: string, data: Record<string, unknown>) {
  const map: Record<string, string> = {
    title: 'title', fileNo: 'file_no', courtCaseNo: 'court_case_no',
    matterType: 'matter_type', cause: 'cause', court: 'court', status: 'status',
    openedOn: 'opened_on', closedOn: 'closed_on', notes: 'notes',
    retentionYears: 'retention_years', clientId: 'client_id',
  }
  const sets: string[] = []; const vals: unknown[] = []
  for (const [k, col] of Object.entries(map)) {
    if (data[k] === undefined) continue
    sets.push(`${col} = $${sets.length + 1}`)
    vals.push(data[k] === '' ? null : data[k])
  }
  if (!sets.length) return
  sets.push('updated_at = now()')
  vals.push(id, userId)
  await db.query(
    `update v2.matters set ${sets.join(', ')}
      where id = $${vals.length - 1} and user_id = $${vals.length}`, vals)

  // 청구원인이 새로 정해지면 체크리스트를 깐다. **이미 있는 것은 건드리지 않는다** (018).
  if (typeof data.cause === 'string' && data.cause) {
    await db.query('select v2.seed_legal_elements($1, $2)', [id, data.cause])
  }
}

/**
 * 사건 하나에 딸린 것 전부. **한 화면에 모이는 것이 이 제품의 값이다** —
 * 상담·기한·요건·시계열·증거가 흩어져 있으면 사건을 파악할 수 없다.
 */
export async function matterDetail(db: pg.Client, id: string) {
  const [meetings, deadlines, elements, timeline, evidence, adverse] = await Promise.all([
    db.query(`select id, title, start_time, kind, analysis_status, privileged
                from v2.meetings where matter_id = $1 and deleted_at is null
               order by start_time desc`, [id]),
    // 가까운 기한부터. **지난 것도 보여 준다** — 지났다고 사라지면 놓친 것을 모른다.
    db.query(`select id, kind, title, due_on, starts_on, basis, is_estimated, status,
                     confirmed_by_email, confirmed_at,
                     v2.deadline_days_left(due_on) as days_left
                from v2.deadlines where matter_id = $1
               order by (status = 'open') desc, due_on asc`, [id]),
    db.query(`select id, cause, element, status, note, sort_order, set_by, set_by_email
                from v2.legal_elements where matter_id = $1 order by sort_order, element`, [id]),
    db.query(`select id, occurred_on, precision, what, legal_meaning, meeting_id
                from v2.timeline_events where matter_id = $1
               order by occurred_on nulls last`, [id]),
    db.query(`select id, kind, what, status, holder, difficulty, proves
                from v2.evidence where matter_id = $1 order by status, kind`, [id]),
    db.query('select id, name, role, note from v2.adverse_parties where matter_id = $1', [id]),
  ])
  return {
    meetings: meetings.rows, deadlines: deadlines.rows, elements: elements.rows,
    timeline: timeline.rows, evidence: evidence.rows, adverseParties: adverse.rows,
  }
}

/**
 * 이해충돌 검사 — **막지 않는다. 보여 준다.**
 *
 * `CLAUDE.md` 의 원칙 그대로다. 수임 여부는 사람이 정한다 —
 * 동명이인일 수도 있고, 이미 종결된 사건이라 문제가 없을 수도 있다.
 * 우리가 할 일은 **놓치지 않게 하는 것**이지 결정하는 것이 아니다.
 */
export async function checkConflict(db: pg.Client, userId: string, name: string) {
  const norm = normalizeName(name)
  if (!norm) return { asAdverse: [], asClient: [] }
  const [asAdverse, asClient] = await Promise.all([
    // 들어온 이름이 **기존 사건의 상대방**인가 — 가장 위험한 경우다
    db.query(`select a.name, a.role, m.id as matter_id, m.title, m.status
                from v2.adverse_parties a join v2.matters m on m.id = a.matter_id
               where m.user_id = $1 and a.name_norm = $2`, [userId, norm]),
    // 들어온 이름이 **기존 의뢰인**인가 — 상대방으로 들어오는 경우를 잡는다
    db.query(`select c.id as client_id, c.company_name as name
                from v2.customers c where c.user_id = $1 and c.name_norm = $2`, [userId, norm]),
  ])
  return { asAdverse: asAdverse.rows, asClient: asClient.rows }
}

export async function addAdverseParty(db: pg.Client, matterId: string, p: {
  name: string; role?: string | null; note?: string | null
}) {
  await db.query(
    `insert into v2.adverse_parties (matter_id, name, name_norm, role, note)
     values ($1,$2,$3,$4,$5)`,
    [matterId, p.name, normalizeName(p.name), p.role || null, p.note || null])
}
