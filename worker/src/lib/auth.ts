// 인증 — jsonwebtoken → jose 전환분
//
// **사내 백엔드와 토큰이 서로 통해야 한다.** 병행 운영 중에는 로그인은 이쪽에서,
// 어떤 라우트는 저쪽에서 처리될 수 있다. 그래서 클레임 구성을 그대로 맞춘다.
//   jsonwebtoken: jwt.sign({sub, email, role}, SECRET, {expiresIn: <초>})
//     → 헤더 {alg:'HS256', typ:'JWT'}, 페이로드 {sub, email, role, iat, exp}
//   jose 로 같은 것을 만든다. 알고리즘·클레임 이름·만료 계산이 모두 일치해야 한다.
//
// bcrypt 는 그대로 둔다. cost 10 에서 엣지 실측 92~103ms 로 CPU 한도의 약 6% 다 (설계 §10).

import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import type { AuthUser, Env } from './env'

const DEFAULT_ACCESS_TTL = 3600
const DEFAULT_REFRESH_TTL = 2592000

function secretKey(env: Env): Uint8Array {
  const s = env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET 시크릿이 없습니다')
  return new TextEncoder().encode(s)
}

export function accessTtl(env: Env): number {
  return Number(env.JWT_EXPIRE_IN ?? DEFAULT_ACCESS_TTL) || DEFAULT_ACCESS_TTL
}
export function refreshTtl(env: Env): number {
  return Number(env.JWT_REFRESH_EXPIRE_IN ?? DEFAULT_REFRESH_TTL) || DEFAULT_REFRESH_TTL
}

/**
 * 미디어 티켓 — `<audio>` 가 쓸 짧고 좁은 토큰 (012).
 *
 * **왜 액세스 토큰을 URL 에 넣지 않나**: `<audio src>` 는 헤더를 붙일 수 없어
 * 토큰을 쿼리에 실어야 하는데, 액세스 토큰은 **계정 전체 권한**이고 한 시간을 산다.
 * 주소가 브라우저 기록·중간 프록시 로그에 남으므로, 새면 그동안 계정이 열린다.
 *
 * 그래서 **녹음 하나만, 10분만** 여는 티켓을 따로 발급한다.
 * 새어도 그 녹음 하나가 잠깐 열릴 뿐이다.
 */
const TICKET_TTL = 600

export async function signMediaTicket(env: Env, userId: string, recordingId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ rec: recordingId, kind: 'media' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + TICKET_TTL)
    .sign(secretKey(env))
}

/** 티켓이 **이 녹음에 대한 것인지**까지 확인한다. 다른 녹음의 티켓으로는 열리지 않는다. */
export async function verifyMediaTicket(
  env: Env, token: string, recordingId: string,
): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(env))
    if (payload.kind !== 'media' || payload.rec !== recordingId || !payload.sub) return null
    return { sub: String(payload.sub) }
  } catch {
    return null
  }
}

/**
 * 토큰이 **무엇에 쓰이는 것인지**. 서명에 함께 넣는다 (2026-08-22).
 *
 * 그전에는 액세스와 리프레시가 **같은 클레임에 수명만 달랐다.** 검증도 종류를 안 봤다.
 * 그래서 리프레시 토큰을 `Authorization: Bearer` 에 그대로 넣으면 통했고,
 * 그 수명이 **30일**이라 액세스 토큰을 1시간으로 짧게 잡아 둔 설계가 무의미했다.
 * 브라우저에 나란히 저장되는 두 값 중 수명이 30배인 쪽이 똑같이 먹히는 셈이었다.
 *
 * `media` 는 012 부터 이미 갈라져 있었다 — 그 갈래를 나머지에도 넓힌 것이다.
 */
export type TokenKind = 'access' | 'refresh' | 'media'

export async function signToken(
  env: Env, user: AuthUser, ttlSeconds: number, kind: TokenKind = 'access',
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: user.email, role: user.role, kind })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey(env))
}

/**
 * 검증 실패는 전부 같은 오류로 묶는다 — 만료인지 위조인지 알려줄 이유가 없다.
 *
 * **`kind` 가 맞아야 한다. 없으면 거절한다.**
 * 유예를 두어 `kind` 없는 옛 토큰을 통과시키면, 하필 **위험한 바로 그 토큰**
 * (이미 발급된 30일짜리 리프레시)이 한 달간 만능 키로 남고 끊을 수단이 없다 —
 * `requireAuth` 는 `v2.sessions` 를 보지 않으므로 세션을 무효화해도 닫히지 않는다.
 * 그래서 **한 번의 재로그인**을 택했다 (2026-08-22, 사용자 결정).
 */
export async function verifyToken(
  env: Env, token: string, expect: TokenKind = 'access',
): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secretKey(env), { algorithms: ['HS256'] })
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const email = typeof payload.email === 'string' ? payload.email : ''
  const role = typeof payload.role === 'string' ? payload.role : ''
  if (payload.kind !== expect) throw new Error('Invalid token')
  if (!sub || !role) throw new Error('Invalid token')
  return { sub, email, role }
}

/** 비밀번호 확인. 해시는 사내 DB 에서 이전한 것을 그대로 쓴다 (cost 10). */
export function checkPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash)
}

/**
 * 새 비밀번호 해시. cost 10 은 기존 해시와 같게 맞춘 값이다 —
 * 엣지 실측 92~103ms 로 CPU 한도의 약 6% 다 (설계 §10). 올리면 지수로 늘어난다.
 */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

/**
 * 비밀번호 최소 길이. **여기 한 곳에서만 정한다.**
 * 예전에는 비밀번호 변경 경로와 계정 생성 경로에 숫자가 따로 박혀 있었다 —
 * 한쪽만 고치면 "만들 수는 있는데 바꿀 수는 없는" 비밀번호가 생긴다.
 *
 * **6 은 사용자가 정한 값이다** (2026-08-26). 이 숫자를 임의로 올리지 않는다 —
 * 올리면 이미 쓰고 있는 비밀번호로 로그인은 되는데 변경은 거부되는 상태가 된다.
 * 세 경로(계정 생성 · 본인 변경 · 관리자 재설정)가 모두 이 값을 본다.
 */
export const MIN_PASSWORD_LENGTH = 8   // IEP: 영문+숫자 조합 8자 (2026-09-01)

/** 통과하면 null, 아니면 사용자에게 보여줄 이유. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`
  }
  // IEP: **영문과 숫자를 모두 포함**한다. 조사관 계정이라 최소한의 강도를 둔다.
  if (!/[A-Za-z]/.test(plain) || !/[0-9]/.test(plain)) {
    return '비밀번호는 영문과 숫자를 모두 포함해야 합니다'
  }
  return null
}
