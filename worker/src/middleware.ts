// 미들웨어 — 사내 백엔드의 middleware/ 4개에 대응
//   auth.ts        → requireAuth
//   adminAuth.ts   → requireAdmin
//   requestLogger  → requestLogger (winston 대신 console; 수집은 Logpush)
//   errorHandler   → app.onError 에서 처리 (index.ts)

import type { MiddlewareHandler } from 'hono'
import { logLine, newRid } from './lib/log'
import type { Env, Vars } from './lib/env'
import { verifyToken } from './lib/auth'

type H = MiddlewareHandler<{ Bindings: Env; Variables: Vars }>

/** 응답 본문 형태는 사내 백엔드와 같게 유지한다 — 프런트엔드가 같은 것을 읽는다. */
export const fail = (code: number, message: string) => ({
  success: false as const,
  error: { code, message },
})

export const requireAuth: H = async (c, next) => {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json(fail(401, 'Missing or invalid authorization header'), 401)
  }
  try {
    c.set('user', await verifyToken(c.env, header.slice(7)))
  } catch {
    // 만료인지 위조인지 구분해 주지 않는다
    return c.json(fail(401, 'Invalid token'), 401)
  }
  await next()
}

export const requireAdmin: H = async (c, next) => {
  if (c.get('user')?.role !== 'admin') {
    return c.json(fail(403, 'Admin privileges required'), 403)
  }
  await next()
}

/**
 * 요청 로그. **경로와 상태만 남긴다.**
 * 사내 백엔드는 winston 으로 같은 일을 하는데, 여기서는 console 로 충분하다 —
 * Workers 의 표준 출력이 그대로 관측 대상이 된다.
 */
export const requestLogger: H = async (c, next) => {
  const started = Date.now()
  // 이 요청의 모든 로그를 묶는 식별자. 화면 오류 하나를 서버 로그 여러 줄과 맞춰 보려면 필요하다.
  const rid = newRid()
  c.set('rid', rid)
  await next()
  logLine('info', 'req', {
    rid,
    m: c.req.method,
    p: new URL(c.req.url).pathname,
    st: c.res.status,
    ms: Date.now() - started,
  })
}
