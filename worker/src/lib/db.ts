// DB 접근. 사내 백엔드의 utils/database.ts 에 대응하지만 Worker 수명에 맞게 다르다.

import pg from 'pg'
import type { Env } from './env'

export function connectionString(env: Env): { url: string; via: 'hyperdrive' | 'direct' } {
  if (env.HYPERDRIVE?.connectionString) {
    return { url: env.HYPERDRIVE.connectionString, via: 'hyperdrive' }
  }
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, via: 'direct' }
  throw new Error('DB 연결 정보가 없습니다 (HYPERDRIVE 바인딩도 DATABASE_URL 시크릿도 없음)')
}

/**
 * 요청마다 클라이언트를 만들고 끝나면 닫는다.
 *
 * 사내 백엔드처럼 모듈 전역에 풀을 캐시하지 않는다 — Worker 는 요청 사이에 살아 있다는
 * 보장이 없고, 살아 있더라도 다른 요청과 공유하면 안 된다.
 * 연결 재사용은 Hyperdrive 가 대신한다 (직접 연결 365ms → 72ms, 설계 §13).
 */
export async function withDb<T>(env: Env, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionString(env).url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

/** 한 행만 필요할 때 (사내 백엔드의 queryOne 과 같은 의미) */
export async function queryOne<T extends pg.QueryResultRow>(
  c: pg.Client, text: string, values?: unknown[],
): Promise<T | null> {
  const r = await c.query<T>(text, values as never)
  return r.rows[0] ?? null
}
