// 401 처리기가 자기 자신을 재귀하지 않는지 확인한다.
//
// 2026-08-10, 세션이 죽은 브라우저 하나가 `POST /auth/refresh` 를 **29,602번** 보냈다.
// 인터셉터가 붙은 axios 인스턴스로 refresh 를 부른 탓에, refresh 의 401 이 다시 인터셉터를 타고
// 또 refresh 를 불렀기 때문이다. 그 끝에서 `window.location.href = '/login'` 이 실행되며
// **녹음 중이던 미팅이 사라졌다.**
//
// 그래서 여기서 세는 것은 "요청 횟수" 다. 논리 설명이 아니라 숫자여야 재발을 막는다.
//
// 실행: npm run test:auth  (VITE_API_URL 을 이 서버로 맞춰서 띄운다)

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, Server } from 'http'

const PORT = 4571

// api.ts 는 localStorage 를 쓴다. jsdom 없이 돌리려고 최소한만 채운다.
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
}

let calls: string[] = []
let server: Server

beforeAll(async () => {
  server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`)
    // 무엇을 물어도 401. 세션이 완전히 죽은 상태를 흉내낸다.
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, error: { code: 401, message: 'Authentication failed' } }))
  })
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r))
})
afterAll(() => new Promise<void>((r) => { server.close(() => r()) }))
beforeEach(() => { calls = []; store.clear() })

const settle = () => new Promise((r) => setTimeout(r, 300))
const refreshCount = () => calls.filter((c) => c.includes('/auth/refresh')).length

describe('401 처리', () => {
  it('세션이 죽어 있어도 요청이 폭주하지 않는다', async () => {
    const { apiClient } = await import('../src/services/api')
    let expired = 0
    // 녹음 중이라 화면을 옮기지 않는 상황을 흉내낸다
    apiClient.setSessionExpiredHandler(() => { expired++ })
    localStorage.setItem('refreshToken', 'stale-token')
    apiClient.setAccessToken('stale-access')

    await expect(apiClient.getCustomers()).rejects.toBeDefined()
    await settle()

    expect(refreshCount()).toBe(1)     // 29,602 가 아니라 1
    expect(calls.length).toBeLessThanOrEqual(3)
    expect(expired).toBe(1)
    apiClient.setSessionExpiredHandler(null)
  })

  it('동시에 여러 요청이 401 을 맞아도 refresh 는 한 번만 나간다', async () => {
    const { apiClient } = await import('../src/services/api')
    apiClient.setSessionExpiredHandler(() => {})
    localStorage.setItem('refreshToken', 'stale-token')
    apiClient.setAccessToken('stale-access')

    await Promise.allSettled([
      apiClient.getCustomers(),
      apiClient.getMeetings(),
      apiClient.getDashboard(),
    ])
    await settle()

    expect(refreshCount()).toBe(1)
    apiClient.setSessionExpiredHandler(null)
  })

  it('refreshToken 이 없으면 refresh 를 아예 부르지 않는다', async () => {
    const { apiClient } = await import('../src/services/api')
    apiClient.setSessionExpiredHandler(() => {})
    apiClient.setAccessToken('stale-access')

    await expect(apiClient.getCustomers()).rejects.toBeDefined()
    await settle()

    expect(refreshCount()).toBe(0)
    apiClient.setSessionExpiredHandler(null)
  })
})
