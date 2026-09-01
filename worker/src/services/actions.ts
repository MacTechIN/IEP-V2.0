// 액션 아이템 — 사내 백엔드 services/actionService.ts 이관분
//
// **소유자 범위를 추가했다.** 원본 `getActions()` 에는 사용자 조건이 아예 없어서
// **모든 사용자가 모든 액션을 봤다.** 라우트도 userId 를 넘기지 않았다.
// 액션은 미팅에 속하고 미팅에는 `user_id` 가 있으므로 그 경로로 좁힌다.
// (지금 `v2.action_items` 는 0행이라 보이는 동작은 달라지지 않는다 — 구멍만 막힌다)

import type pg from 'pg'
import { queryOne } from '../lib/db'

export interface ActionRow {
  id: string; meeting_id: string; action_text: string
  priority: string; due_date: string | null
  assigned_to_user_id: string | null; status: string
  created_at: string; updated_at: string
}

const COLS = `a.id, a.meeting_id, a.action_text, a.priority, a.due_date,
              a.assigned_to_user_id, a.status, a.created_at, a.updated_at`

export const toAction = (r: ActionRow) => ({
  id: r.id,
  meetingId: r.meeting_id,
  actionText: r.action_text,
  priority: r.priority,
  dueDate: r.due_date,
  assignedToUserId: r.assigned_to_user_id,
  status: r.status,
  createdAt: r.created_at,
})

// 범위 규칙: 내 미팅의 액션이거나 나에게 배정된 것. 관리자는 전부.
export async function listActions(
  db: pg.Client, userId: string, isAdmin: boolean,
  opts: { limit: number; offset: number; status?: string },
) {
  const where: string[] = ['($1::boolean or m.user_id = $2 or a.assigned_to_user_id = $2)']
  const vals: unknown[] = [isAdmin, userId]
  if (opts.status) { where.push(`a.status = $${vals.length + 1}`); vals.push(opts.status) }
  const cond = where.join(' and ')

  const rows = await db.query<ActionRow>(
    `select ${COLS} from v2.action_items a
       join v2.meetings m on m.id = a.meeting_id
      where ${cond}
      order by a.created_at desc
      limit $${vals.length + 1} offset $${vals.length + 2}`,
    [...vals, opts.limit, opts.offset])
  const count = await queryOne<{ count: string }>(db,
    `select count(*) as count from v2.action_items a
       join v2.meetings m on m.id = a.meeting_id where ${cond}`, vals)
  return { actions: rows.rows.map(toAction), total: Number(count?.count ?? 0) }
}

/** 접근 가능한 액션 한 건. 아니면 null. */
export async function getAction(
  db: pg.Client, id: string, userId: string, isAdmin: boolean,
): Promise<ActionRow | null> {
  return queryOne<ActionRow>(db,
    `select ${COLS} from v2.action_items a
       join v2.meetings m on m.id = a.meeting_id
      where a.id = $1 and ($2::boolean or m.user_id = $3 or a.assigned_to_user_id = $3)`,
    [id, isAdmin, userId])
}

export async function createAction(db: pg.Client, data: {
  meetingId: string; actionText: string; priority?: string
  dueDate?: string | null; assignedToUserId?: string | null
}) {
  return queryOne<ActionRow>(db,
    `insert into v2.action_items
       (id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at)
     values (gen_random_uuid(), $1,$2,$3,$4,$5,'pending', now(), now())
     returning id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at`,
    [data.meetingId, data.actionText, data.priority ?? 'medium',
     data.dueDate ?? null, data.assignedToUserId ?? null])
}

export async function updateAction(db: pg.Client, id: string, data: Record<string, unknown>) {
  const sets: string[] = []
  const vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  if (typeof data.actionText === 'string') put('action_text', data.actionText)
  if (typeof data.priority === 'string') put('priority', data.priority)
  if (typeof data.dueDate === 'string') put('due_date', data.dueDate)
  if (typeof data.status === 'string') {
    put('status', data.status)
    if (data.status === 'completed') sets.push('completed_at = now()')
  }
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  vals.push(id)
  await db.query(`update v2.action_items set ${sets.join(', ')} where id = $${vals.length}`, vals)
}

export async function deleteAction(db: pg.Client, id: string) {
  const r = await db.query('delete from v2.action_items where id = $1', [id])
  return (r.rowCount ?? 0) > 0
}
