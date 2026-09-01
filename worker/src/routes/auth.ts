// /api/v2/auth — 사내 백엔드 routes/auth.ts + services/authService.ts 이관분
//
// 응답 형태는 그대로 맞춘다. 프런트엔드가 `data.accessToken` 을 읽고 있고,
// 이관 중에는 두 백엔드가 같은 화면을 상대하기 때문이다.
//
// 한 가지는 일부러 다르게 했다 — §아래 '사용자 존재 여부' 참고.

import { Hono } from 'hono'
import type { Env, Vars } from '../lib/env'
import { withDb, queryOne } from '../lib/db'
import { accessTtl, checkPassword, hashPassword, passwordProblem, refreshTtl, signToken, verifyToken } from '../lib/auth'
import { fail } from '../middleware'

interface UserRow {
  id: string
  email: string
  name: string | null
  password_hash: string
  role: string
  department: string | null
  monthly_target_krw: number | null
  created_at: string
  updated_at: string
}

const auth = new Hono<{ Bindings: Env; Variables: Vars }>()

auth.post('/login', async (c) => {
  type LoginBody = { email?: string; password?: string }
  const body: LoginBody = await c.req.json<LoginBody>().catch(() => ({} as LoginBody))
  const email = body.email?.trim()
  const password = body.password
  if (!email || !password) {
    return c.json(fail(400, 'Email and password are required'), 400)
  }

  // ── 시도 제한 (013)
  //
  // **두 축으로 센다.** 이메일만 세면 여러 계정에 조금씩 뿌리는 대입이 안 잡히고,
  // IP 만 세면 한 계정을 여러 곳에서 노리는 대입이 안 잡힌다.
  //
  // 계정을 잠그지는 않는다 — 최대 15분 기다리게 할 뿐이고 성공하면 즉시 풀린다.
  // 남의 이메일로 5번 틀려서 그 사람을 15분 막는 것은 여전히 가능하지만,
  // 무한 대입을 열어 두는 쪽이 더 나쁘다.
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const keys = [`e:${email.toLowerCase()}`, `i:${ip}`]

  // 사용자 존재 여부를 응답으로 구분해 주지 않는다.
  //
  // 사내 백엔드는 details.error 에 'User not found' 와 'Invalid password' 를 그대로 실어 보낸다.
  // 화면에는 안 쓰이지만, 그것만으로 **어떤 이메일이 가입돼 있는지 확인할 수 있다.**
  // 여기서는 두 경우 모두 같은 응답을 준다. 진짜 이유는 로그에만 남긴다.
  const result = await withDb(c.env, async (db) => {
    const blocked = await queryOne<{ until: string | null }>(db,
      'select v2.login_blocked($1) as until', [keys])
    if (blocked?.until) {
      const wait = Math.max(1, Math.ceil((Date.parse(blocked.until) - Date.now()) / 1000))
      return { reason: 'throttled' as const, wait }
    }

    const user = await queryOne<UserRow>(db,
      `select id, email, name, password_hash, role, department, monthly_target_krw,
              created_at, updated_at
         from v2.users where email = $1 and is_active = true`, [email])
    // 없는 계정도 센다. 안 그러면 이메일이 가입돼 있는지 무한정 떠볼 수 있다.
    if (!user) {
      await db.query('select v2.login_fail(k) from unnest($1::text[]) k', [keys])
      return { reason: 'no-user' as const }
    }
    if (!checkPassword(password, user.password_hash)) {
      await db.query('select v2.login_fail(k) from unnest($1::text[]) k', [keys])
      return { reason: 'bad-password' as const }
    }
    // 성공했으니 지운다 — 다음 로그인은 처음부터 센다.
    await db.query('select v2.login_ok($1)', [keys])

    const claims = { sub: user.id, email: user.email, role: user.role }
    const [accessToken, refreshToken] = await Promise.all([
      signToken(c.env, claims, accessTtl(c.env), 'access'),
      signToken(c.env, claims, refreshTtl(c.env), 'refresh'),
    ])

    const expiresAt = new Date(Date.now() + refreshTtl(c.env) * 1000)
    await db.query(
      'insert into v2.sessions (user_id, refresh_token, is_active, expires_at) values ($1,$2,$3,$4)',
      [user.id, refreshToken, true, expiresAt])
    await db.query('update v2.users set last_login_at = now() where id = $1', [user.id])

    return {
      reason: 'ok' as const,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          department: user.department,
          monthlyTargetKrw: user.monthly_target_krw,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
        expiresIn: accessTtl(c.env),
      },
    }
  })

  if (result.reason === 'throttled') {
    // 429 는 **일부러 401 과 구분한다.** 사용자에게 "왜 안 되는지" 를 알려 주지 않으면
    // 비밀번호를 계속 바꿔 가며 시도하게 되고, 그럴수록 더 오래 막힌다.
    // 계정 존재 여부는 여기서도 새지 않는다 — 없는 계정도 똑같이 막힌다.
    console.log('login throttled')
    return c.json(fail(429, `시도가 너무 많습니다. ${result.wait}초 뒤에 다시 시도하세요.`), 429, {
      'Retry-After': String(result.wait),
    })
  }
  if (result.reason !== 'ok') {
    console.log(`login failed (${result.reason})`)   // 이메일은 남기지 않는다
    return c.json(fail(401, 'Authentication failed'), 401)
  }
  return c.json({ success: true, data: result.data })
})

auth.post('/refresh', async (c) => {
  type RefreshBody = { refreshToken?: string }
  const body: RefreshBody = await c.req.json<RefreshBody>().catch(() => ({} as RefreshBody))
  const refreshToken = body.refreshToken
  if (!refreshToken) return c.json(fail(400, 'Refresh token is required'), 400)

  let claims
  try {
    // **리프레시 자리에는 리프레시만.** 액세스 토큰으로 갱신을 시도할 수 없다.
    claims = await verifyToken(c.env, refreshToken, 'refresh')
  } catch {
    return c.json(fail(401, 'Token refresh failed'), 401)
  }

  // 서명이 멀쩡해도 **세션이 살아 있어야 한다.** 로그아웃·강제 종료를 이 테이블로 다룬다.
  const outcome = await withDb(c.env, async (db) => {
    const session = await queryOne<{ id: string; expires_at: string }>(db,
      'select id, expires_at from v2.sessions where refresh_token = $1 and is_active = true',
      [refreshToken])
    if (!session) return 'no-session' as const
    if (new Date(session.expires_at) < new Date()) {
      await db.query(
        'update v2.sessions set is_active = false, revoked_at = now() where id = $1', [session.id])
      return 'expired' as const
    }
    return 'ok' as const
  })
  if (outcome !== 'ok') return c.json(fail(401, 'Token refresh failed'), 401)

  return c.json({
    success: true,
    data: {
      accessToken: await signToken(c.env, claims, accessTtl(c.env), 'access'),
      expiresIn: accessTtl(c.env),
    },
  })
})

// 사내 백엔드는 여기가 비어 있었다(TODO). 세션을 실제로 끊는다 —
// refresh 가 세션 테이블을 보므로, 이걸 안 끊으면 로그아웃해도 토큰이 30일간 살아 있다.
auth.post('/logout', async (c) => {
  type RefreshBody = { refreshToken?: string }
  const body: RefreshBody = await c.req.json<RefreshBody>().catch(() => ({} as RefreshBody))
  if (body.refreshToken) {
    await withDb(c.env, (db) => db.query(
      'update v2.sessions set is_active = false, revoked_at = now() where refresh_token = $1',
      [body.refreshToken])).catch(() => {})
  }
  return c.json({ success: true, data: { message: '로그아웃 완료' } })
})

/**
 * 비밀번호 변경. **이 경로가 없어서 시드 비밀번호를 바꿀 방법이 없었다.**
 *
 * 바꾸면 기존 세션을 전부 끊는다 — 비밀번호를 바꾸는 흔한 이유가
 * "누가 알고 있는 것 같다" 이기 때문이다. 살아 있는 리프레시 토큰을 남기면 소용이 없다.
 */
auth.post('/change-password', async (c) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) return c.json(fail(401, 'Unauthorized'), 401)
  let me
  try { me = await verifyToken(c.env, header.slice(7)) } catch { return c.json(fail(401, 'Unauthorized'), 401) }

  type Body = { currentPassword?: string; newPassword?: string }
  const body: Body = await c.req.json<Body>().catch(() => ({} as Body))
  const cur = body.currentPassword
  const next = body.newPassword
  if (!cur || !next) return c.json(fail(400, 'currentPassword and newPassword are required'), 400)
  const problem = passwordProblem(next)
  if (problem) return c.json(fail(400, problem), 400)
  if (next === cur) return c.json(fail(400, '기존 비밀번호와 같습니다'), 400)

  const outcome = await withDb(c.env, async (db) => {
    const row = await queryOne<{ password_hash: string }>(db,
      'select password_hash from v2.users where id = $1 and is_active = true', [me.sub])
    if (!row) return 'no-user' as const
    if (!checkPassword(cur, row.password_hash)) return 'bad-password' as const
    await db.query('update v2.users set password_hash = $2, updated_at = now() where id = $1',
      [me.sub, hashPassword(next)])
    // 세션 전부 무효화
    await db.query(
      'update v2.sessions set is_active = false, revoked_at = now() where user_id = $1 and is_active = true',
      [me.sub])
    return 'ok' as const
  })

  if (outcome === 'bad-password') return c.json(fail(401, 'Authentication failed'), 401)
  if (outcome === 'no-user') return c.json(fail(404, 'User not found'), 404)
  return c.json({ success: true, data: { message: '비밀번호가 변경되었습니다. 다시 로그인해 주세요.' } })
})

export default auth
