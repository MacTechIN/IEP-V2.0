// 사용자 — 사내 백엔드 services/userService.ts + authService 의 조회·수정분

import type pg from 'pg'
import { queryOne } from '../lib/db'

export interface UserRow {
  id: string; email: string; name: string | null; role: string
  department: string | null; monthly_target_krw: number | null
  // 수사관 프로필 (026). 전부 nullable — **사무장은 bar_no 가 없다**
  bar_no?: string | null; firm_name?: string | null; position?: string | null
  bar_association?: string | null; practice_areas?: string[] | null
  agency?: string | null
  phone?: string | null; office_phone?: string | null; office_address?: string | null
  created_at: string; updated_at: string
}

export const toUser = (r: UserRow) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  department: r.department,
  // **IEP 에서는 쓰지 않는다** — 영업 목표액이다. 화면에서 감췄고 컬럼만 남겨 뒀다 (026).
  monthlyTargetKrw: r.monthly_target_krw,
  // 수사관 프로필 (026). 사무장은 barNo 가 비어 있다.
  barNo: r.bar_no ?? null,
  firmName: r.firm_name ?? null,
  position: r.position ?? null,
  barAssociation: r.bar_association ?? null,
  agency: r.agency ?? null,
  practiceAreas: r.practice_areas ?? [],
  phone: r.phone ?? null,
  officePhone: r.office_phone ?? null,
  officeAddress: r.office_address ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export async function getUser(db: pg.Client, userId: string) {
  return queryOne<UserRow>(db,
    `select id, email, name, role, department, monthly_target_krw,
            bar_no, firm_name, position, bar_association, practice_areas, agency,
            phone, office_phone, office_address, created_at, updated_at
       from v2.users where id = $1 and is_active = true`, [userId])
}

/**
 * 자기 자신만 수정한다. **role 은 여기서 바꿀 수 없다** —
 * 화이트리스트에 넣지 않았으므로 본문에 role 을 실어 보내도 무시된다.
 */
export async function updateUser(db: pg.Client, userId: string, data: Record<string, unknown>) {
  const sets: string[] = []
  const vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  // **빈 문자열은 null 로 넣는다.** 지우려고 비운 칸이 `''` 로 남으면
  // "있는데 빈 값" 과 "없음" 이 구별되지 않는다 — 문서에 빈 괄호가 찍힌다.
  const text = (key: string, col: string) => {
    const v = data[key]
    if (typeof v !== 'string') return
    put(col, v.trim() === '' ? null : v.trim())
  }
  if (typeof data.name === 'string' && data.name.trim()) put('name', data.name.trim())
  if (typeof data.department === 'string') put('department', data.department)
  if (typeof data.monthlyTargetKrw === 'number') put('monthly_target_krw', data.monthlyTargetKrw)
  // 수사관 프로필 (026). **role 과 email 은 여기 없다** — 화이트리스트 밖은 무시된다.
  text('barNo', 'bar_no')
  text('firmName', 'firm_name')
  text('position', 'position')
  text('barAssociation', 'bar_association')
  text('agency', 'agency')
  text('phone', 'phone')
  text('officePhone', 'office_phone')
  text('officeAddress', 'office_address')
  if (Array.isArray(data.practiceAreas)) {
    put('practice_areas', data.practiceAreas
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map((x) => x.trim()).slice(0, 12))
  }
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  vals.push(userId)
  await db.query(`update v2.users set ${sets.join(', ')} where id = $${vals.length}`, vals)
}

// ─────────── 관리자 전용 (사내 authService 의 listUsers · createUser · setUserActive 이관분)

export interface AdminUserRow extends UserRow {
  is_active: boolean
  last_login_at: string | null
}

export const toAdminUser = (r: AdminUserRow) => ({
  ...toUser(r),
  isActive: r.is_active,
  lastLoginAt: r.last_login_at,
})

/** 비활성 사용자도 포함한다 — 관리 화면에서 다시 켜야 하기 때문이다. */
export async function listUsers(db: pg.Client): Promise<AdminUserRow[]> {
  const r = await db.query<AdminUserRow>(
    `select id, email, name, role, department, monthly_target_krw,
            is_active, last_login_at, created_at, updated_at
       from v2.users order by created_at asc`)
  return r.rows
}

/**
 * 사용자를 만든다. 이메일이 이미 있으면 null 을 돌려준다 (예외 대신).
 *
 * **role 은 부르는 쪽에서 이미 걸러진 값이어야 한다.** 본문 값을 그대로 넣으면
 * 관리자가 아닌 값이나 오타가 그대로 저장된다.
 */
export async function createUser(
  db: pg.Client, email: string, name: string, passwordHash: string, role: string,
): Promise<AdminUserRow | null> {
  const dup = await queryOne<{ id: string }>(db,
    'select id from v2.users where email = $1', [email])
  if (dup) return null
  return queryOne<AdminUserRow>(db, `
    insert into v2.users (email, name, password_hash, role, is_verified)
    values ($1, $2, $3, $4, true)
    returning id, email, name, role, department, monthly_target_krw,
              is_active, last_login_at, created_at, updated_at
  `, [email, name, passwordHash, role])
}

/**
 * 활성/비활성 전환. 비활성화하면 **살아 있는 세션도 함께 끊는다** —
 * 원본은 `is_active` 만 껐는데, 이미 로그인해 둔 사람은 토큰이 만료될 때까지 계속 쓸 수 있었다.
 */
export async function setActive(db: pg.Client, userId: string, isActive: boolean): Promise<boolean> {
  const r = await db.query('update v2.users set is_active = $1, updated_at = now() where id = $2',
    [isActive, userId])
  if (r.rowCount === 0) return false
  if (!isActive) {
    await db.query(
      'update v2.sessions set is_active = false, revoked_at = now() where user_id = $1 and is_active = true',
      [userId])
  }
  return true
}

// ─────────── 본인 목소리 등록 (v1 0027 과 같은 설계)

export interface VoiceRef {
  storage_path: string
  duration_ms: number
  mime: string
  enrolled_at: string
}

/** STT 에 넘길 등록 정보. 이름은 실명이 없으면 이메일 앞부분을 쓴다. */
export interface VoiceEnrollment { name: string; ref: VoiceRef }

export async function getVoiceRef(db: pg.Client, userId: string): Promise<VoiceRef | null> {
  const r = await queryOne<{ voice_ref: VoiceRef | null }>(db,
    'select voice_ref from v2.users where id = $1', [userId])
  return r?.voice_ref ?? null
}

/**
 * 전사할 때 쓸 등록 정보. **본인 것만** 가져온다 —
 * 남의 목소리를 등록하지 않는 것이 이 기능의 설계 전제다.
 */
export async function getEnrollment(db: pg.Client, userId: string): Promise<VoiceEnrollment | null> {
  const r = await queryOne<{ name: string | null; email: string; voice_ref: VoiceRef | null }>(db,
    'select name, email, voice_ref from v2.users where id = $1', [userId])
  if (!r?.voice_ref) return null
  return { name: (r.name || r.email.split('@')[0] || '나').trim(), ref: r.voice_ref }
}

export async function setVoiceRef(db: pg.Client, userId: string, ref: VoiceRef | null): Promise<void> {
  await db.query('update v2.users set voice_ref = $2, updated_at = now() where id = $1',
    [userId, ref ? JSON.stringify(ref) : null])
}
