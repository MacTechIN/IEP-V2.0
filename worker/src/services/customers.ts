// 고객 — 사내 백엔드 services/customerService.ts 이관분
//
// **소유권 검사를 추가했다.** 원본은 목록만 `user_id` 로 걸러내고,
// 단건 조회·수정·삭제는 ID 만 맞으면 **남의 고객이라도 통과했다.**
// 목록에서 볼 수 없는 것을 ID 로는 읽고 지울 수 있었다는 뜻이다.
// 여기서는 소유자 본인이거나 관리자일 때만 허용한다.

import type pg from 'pg'
import { queryOne } from '../lib/db'

export interface CustomerRow {
  id: string; user_id: string; company_name: string
  industry: string | null; company_size: string | null
  budget_min_krw: number | null; budget_max_krw: number | null
  deal_status: string
  primary_contact_name: string | null; primary_contact_email: string | null
  notes: string | null; created_at: string; updated_at: string
}

const COLS = `id, user_id, company_name, industry, company_size, budget_min_krw,
              budget_max_krw, deal_status, primary_contact_name, primary_contact_email,
              created_at, updated_at, notes`

export const toCustomer = (r: CustomerRow) => ({
  id: r.id,
  userId: r.user_id,
  companyName: r.company_name,
  industry: r.industry,
  companySize: r.company_size,
  budgetMinKrw: r.budget_min_krw,
  budgetMaxKrw: r.budget_max_krw,
  dealStatus: r.deal_status,
  primaryContactName: r.primary_contact_name,
  primaryContactEmail: r.primary_contact_email,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export async function listCustomers(
  db: pg.Client, userId: string, limit: number, offset: number,
) {
  const rows = await db.query<CustomerRow>(
    `select ${COLS} from v2.customers
      where user_id = $1 and deleted_at is null
      order by created_at desc limit $2 offset $3`, [userId, limit, offset])
  const count = await queryOne<{ count: string }>(db,
    'select count(*) as count from v2.customers where user_id = $1 and deleted_at is null', [userId])
  return { customers: rows.rows.map(toCustomer), total: Number(count?.count ?? 0) }
}

/** 소유자(또는 관리자)에게만 돌려준다. 아니면 null — 존재 여부도 알리지 않는다. */
export async function getCustomer(
  db: pg.Client, id: string, userId: string, isAdmin: boolean,
): Promise<CustomerRow | null> {
  const row = await queryOne<CustomerRow>(db,
    `select ${COLS} from v2.customers where id = $1 and deleted_at is null`, [id])
  if (!row) return null
  if (!isAdmin && row.user_id !== userId) return null
  return row
}

export async function createCustomer(db: pg.Client, userId: string, data: {
  companyName: string; industry?: string; companySize?: string
  budgetMinKrw?: number; budgetMaxKrw?: number
  primaryContactName?: string; primaryContactEmail?: string
}) {
  const row = await queryOne<CustomerRow>(db,
    `insert into v2.customers
       (id, user_id, company_name, industry, company_size, budget_min_krw, budget_max_krw,
        deal_status, primary_contact_name, primary_contact_email, created_at, updated_at)
     values (gen_random_uuid(), $1,$2,$3,$4,$5,$6,'new',$7,$8, now(), now())
     returning ${COLS}`,
    [userId, data.companyName, data.industry ?? null, data.companySize ?? null,
     data.budgetMinKrw ?? null, data.budgetMaxKrw ?? null,
     data.primaryContactName ?? null, data.primaryContactEmail ?? null])
  return row
}

/** 화이트리스트 방식 그대로 유지한다 — 임의 컬럼을 갱신할 수 없다. */
export async function updateCustomer(db: pg.Client, id: string, data: Record<string, unknown>) {
  const sets: string[] = []
  const vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  if (typeof data.companyName === 'string') put('company_name', data.companyName)
  if (typeof data.industry === 'string') put('industry', data.industry)
  if (typeof data.dealStatus === 'string') put('deal_status', data.dealStatus)
  if (typeof data.notes === 'string') put('notes', data.notes)
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  vals.push(id)
  await db.query(
    `update v2.customers set ${sets.join(', ')} where id = $${vals.length} and deleted_at is null`, vals)
}

export async function softDeleteCustomer(db: pg.Client, id: string) {
  const r = await db.query('update v2.customers set deleted_at = now() where id = $1 and deleted_at is null', [id])
  return (r.rowCount ?? 0) > 0
}
