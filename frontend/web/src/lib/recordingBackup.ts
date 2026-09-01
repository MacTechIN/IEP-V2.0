// 녹음 조각 로컬 백업
//
// **왜 필요한가**
//   녹음은 업로드되기 전까지 브라우저 메모리에만 있다. 탭이 닫히거나 페이지가 이동하면 그걸로 끝이다.
//   2026-08-10 저녁, 세션이 끊긴 상태에서 401 처리기가 `window.location.href = '/login'` 을 실행했고
//   **녹음 중이던 미팅이 통째로 사라졌다.** 서버에는 아무것도 도달하지 않았다.
//   그 경로는 막았지만(세션 만료 핸들러·이탈 경고), 브라우저 강제 종료 같은 **모르는 경로**는 남는다.
//
//   그래서 녹음 중에 조각을 IndexedDB 에 쌓고, 업로드가 확인된 뒤에 지운다.
//   남아 있는 항목이 있다는 것은 곧 "올라가지 못한 녹음이 있다" 는 뜻이고, 다음 방문에 복구할 수 있다.
//
// localStorage 가 아니라 IndexedDB 인 이유: Blob 을 그대로 저장할 수 있고 용량 한도가 훨씬 크다.
// localStorage 는 보통 5MB 라 몇 분짜리 녹음도 담지 못한다.

const DB_NAME = 'lep-recording-backup'
const DB_VERSION = 1
const STORE = 'chunks'

export interface PendingChunk {
  key: string
  session_id: string
  index: number
  blob: Blob
  mime: string
  created_at: number
}

export interface PendingSession {
  session_id: string
  chunks: PendingChunk[]
  mime: string
  started_at: number
  bytes: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('session_id', 'session_id', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  }))
}

const keyOf = (sessionId: string, index: number) => `${sessionId}:${String(index).padStart(6, '0')}`

/** 녹음 한 건을 식별하는 값. 조각들을 이걸로 묶는다. */
export function newSessionId(): string {
  return `r${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 조각 하나를 보관한다.
 * **실패해도 녹음을 막지 않는다** — 백업은 안전망이지 전제 조건이 아니다.
 * (시크릿 모드 등에서 IndexedDB 를 못 쓸 수 있다)
 */
export async function backupChunk(
  sessionId: string, index: number, blob: Blob, mime: string,
): Promise<boolean> {
  try {
    const record: PendingChunk = {
      key: keyOf(sessionId, index),
      session_id: sessionId,
      index,
      blob,
      mime,
      created_at: Date.now(),
    }
    await tx('readwrite', (s) => s.put(record))
    return true
  } catch (err) {
    console.warn('recording backup failed (continuing without it):', err)
    return false
  }
}

/** 업로드가 확인된 녹음의 백업을 지운다. 여기서 지워야 "남아 있음 = 올라가지 못함" 이 성립한다. */
export async function clearSession(sessionId: string): Promise<void> {
  try {
    const keys = await tx<string[]>('readonly', (s) =>
      s.index('session_id').getAllKeys(sessionId) as unknown as IDBRequest<string[]>)
    for (const k of keys) await tx('readwrite', (s) => s.delete(k))
  } catch (err) {
    console.warn('recording backup cleanup failed:', err)
  }
}

/** 아직 올라가지 못한 녹음들 (최근 것부터) */
export async function listPending(): Promise<PendingSession[]> {
  try {
    const all = await tx<PendingChunk[]>('readonly', (s) => s.getAll() as IDBRequest<PendingChunk[]>)
    const bySession = new Map<string, PendingChunk[]>()
    for (const c of all) {
      const list = bySession.get(c.session_id) || []
      list.push(c)
      bySession.set(c.session_id, list)
    }
    return [...bySession.entries()]
      .map(([session_id, chunks]) => {
        chunks.sort((a, b) => a.index - b.index)
        return {
          session_id,
          chunks,
          mime: chunks[0]?.mime || 'audio/webm',
          started_at: chunks[0]?.created_at || 0,
          bytes: chunks.reduce((n, c) => n + c.blob.size, 0),
        }
      })
      .sort((a, b) => b.started_at - a.started_at)
  } catch (err) {
    console.warn('recording backup lookup failed:', err)
    return []
  }
}

/**
 * 보관된 조각들을 하나의 파일로 되살린다.
 *
 * MediaRecorder 를 timeslice 로 돌리면 **첫 조각에만 컨테이너 헤더가 있고** 나머지는 이어지는 데이터다.
 * 그래서 순서대로 이어 붙여야 재생 가능한 파일이 된다 — 중간 조각 하나만 따로 떼면 열리지 않는다.
 */
export function toFile(session: PendingSession): File {
  const blob = new Blob(session.chunks.map((c) => c.blob), { type: session.mime })
  const ext = session.mime.includes('ogg') ? 'ogg' : session.mime.includes('mp4') ? 'mp4' : 'webm'
  return new File([blob], `recovered.${ext}`, { type: session.mime })
}

/**
 * 보관된 녹음을 **디스크로 뺀다.**
 *
 * 올리기(`recoverSession`)와 달리 `prepareRecordings` 를 거치지 않는다. 그게 요점이다 —
 * 2026-08-20 에 83분 녹음이 통째로 사라진 경로가 바로 그 변환이었다.
 * webm 전체를 `decodeAudioData` 하면 48kHz 스테레오 float32 로 펴져 1.9GB 가 되고 탭이 죽는다.
 * 여기서는 조각을 이어 붙여 그대로 저장만 한다 — **길이와 무관하게 안전하다.**
 *
 * 파일 이름에 녹음 시각을 넣는다. `recovered.webm` 세 개를 받아 놓고 어느 것이 어느 회의인지
 * 모르게 되는 것이 실제로 곤란하다.
 */
export function sessionFileName(session: PendingSession, ext: string): string {
  const d = new Date(session.started_at || Date.now())
  const p = (n: number) => String(n).padStart(2, '0')
  // 파일 이름은 ASCII 로만 짓는다. 한글 이름은 iOS 공유 시트와 일부 메일 클라이언트에서
  // 깨지거나 통째로 잘린다 — 받은 쪽이 못 여는 이름은 이름이 아니다.
  return `sep-rec-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}.${ext}`
}

/**
 * 보관된 녹음을 **브라우저 밖으로 뺀다.**
 *
 * 올리기(`recoverSession`)와 달리 `prepareRecordings` 를 거치지 않는다. 그게 요점이다 —
 * 2026-08-20 에 83분 녹음이 통째로 사라진 경로가 바로 그 변환이었다.
 * 파일 전체를 `decodeAudioData` 하면 48kHz 스테레오 float32 로 펴져 1.9GB 가 되고 탭이 죽는다.
 * 여기서는 조각을 이어 붙여 그대로 내보내기만 한다 — **길이와 무관하게 안전하다.**
 *
 * **모바일에서는 `<a download>` 를 믿을 수 없다.** 그 사고가 난 기기가 iOS 였고
 * (업로드된 파일 확장자가 `.mp4` — WebKit MediaRecorder 의 서명이다), iOS Safari 는
 * blob 다운로드를 조용히 무시하거나 열어만 보고 끝내는 일이 잦다. 되찾을 길이 그것뿐인데
 * 눌러도 아무 일이 없으면 그건 없는 기능이다.
 *
 * 그래서 공유 시트(`navigator.share`)를 **먼저** 쓴다 — "파일에 저장" · AirDrop · 메일이
 * 전부 거기서 되고, iOS 에서 실제로 동작하는 유일한 내보내기다.
 * 지원하지 않는 브라우저에서만 예전 방식으로 떨어진다.
 *
 * 취소(`AbortError`)는 실패가 아니다. 사용자가 그만둔 것이므로 조용히 돌아간다.
 */
export async function saveSession(session: PendingSession): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = toFile(session)
  const named = new File([file], sessionFileName(session, file.name.split('.').pop() || 'webm'), {
    type: file.type,
  })

  const nav = navigator as Navigator & {
    canShare?: (d: ShareData) => boolean
    share?: (d: ShareData) => Promise<void>
  }
  if (nav.share && nav.canShare?.({ files: [named] })) {
    try {
      await nav.share({ files: [named], title: named.name })
      return 'shared'
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled'
      // 공유가 막힌 경우(권한·용량)에는 내려받기로 물러난다. 여기서 끝내면 길이 없다.
    }
  }

  const url = URL.createObjectURL(named)
  const a = document.createElement('a')
  a.href = url
  a.download = named.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 곧바로 취소하면 저장이 시작되기 전에 URL 이 죽는 브라우저가 있다.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

/**
 * 보관함이 **어떤 상태인지** 한 줄로 말한다.
 *
 * `listPending()` 은 실패해도 빈 배열을 돌려준다 — 녹음을 막지 않으려는 것이라 그건 맞다.
 * 그런데 그 때문에 "보관된 것이 없다" 와 "IndexedDB 를 열지 못했다" 가 화면에서 똑같아 보인다.
 * 2026-08-20 에 아이폰 사파리에서 배너가 안 보인다는 신고를 받았을 때, 그 둘 중
 * 어느 쪽인지 알 방법이 없었다 — **모바일에는 콘솔이 없다.** 그래서 따로 묻는 길을 낸다.
 */
export async function inspectBackup(): Promise<{ ok: boolean; sessions: number; chunks: number; error?: string }> {
  try {
    const all = await tx<PendingChunk[]>('readonly', (s) => s.getAll() as IDBRequest<PendingChunk[]>)
    return { ok: true, sessions: new Set(all.map((c) => c.session_id)).size, chunks: all.length }
  } catch (err) {
    return { ok: false, sessions: 0, chunks: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 며칠 지난 백업은 치운다. 복구할 의사가 있었다면 그 전에 했을 것이다. */
export async function pruneOlderThan(days: number): Promise<void> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  for (const s of await listPending()) {
    if (s.started_at && s.started_at < cutoff) await clearSession(s.session_id)
  }
}
