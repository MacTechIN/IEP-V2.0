// 구조화 로그 — **관측만 한다. 동작을 바꾸지 않는다.**
//
// 왜 필요한가
//   업로드가 실패했을 때 화면은 "전사 실패" 한 줄만 보여줬고, 서버에는 무엇이 얼마나 걸렸는지
//   남는 게 없었다. 원인을 알아내려면 매번 파일을 다시 올려 재현해야 했고, 한 번에 3분씩 걸렸다.
//   2026-08-11 의 고아 파일 4개도 "R2 에는 있는데 DB 에는 없다" 는 사실만 알 뿐,
//   **어느 단계에서 끊겼는지는 끝내 로그로 확인하지 못했다.**
//
// 그래서 단계마다 한 줄씩 남긴다. 한 요청의 줄들은 같은 `rid` 로 묶인다.
//
// **내용은 절대 남기지 않는다.** 전사문·토큰·비밀번호는 로그에 들어가지 않는다 —
// 길이와 시간만 남긴다. 예전에 진단하느라 전사 내용을 찍었다가 걷어낸 적이 있다.

/** 한 요청을 따라다니는 짧은 식별자. 로그를 묶는 용도라 8자면 충분하다. */
export function newRid(): string {
  return crypto.randomUUID().slice(0, 8)
}

type Fields = Record<string, string | number | boolean | null | undefined>

/**
 * 한 줄에 `key=value` 로 남긴다. 사람이 읽을 수 있고 `grep` 도 되고,
 * Workers Logs 에서 필드로 검색도 된다.
 */
export function logLine(level: 'info' | 'warn' | 'error', event: string, f: Fields = {}): void {
  const parts = [`ev=${event}`]
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null) continue
    const s = String(v)
    // 값에 공백이 있으면 따옴표로 묶는다. 파싱하는 쪽이 편하다.
    parts.push(`${k}=${/\s/.test(s) ? JSON.stringify(s) : s}`)
  }
  const line = parts.join(' ')
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * 단계별 소요 시간을 재는 작은 타이머.
 *
 * `mark()` 는 **직전 단계로부터의 시간**을, `total` 은 시작부터의 시간을 준다.
 * 어디서 시간을 쓰는지 알려면 누적값만으로는 부족하다.
 */
export function stopwatch() {
  const t0 = Date.now()
  let last = t0
  return {
    /** 직전 mark 이후 경과(ms) */
    mark(): number {
      const now = Date.now()
      const d = now - last
      last = now
      return d
    },
    /** 시작 이후 경과(ms) */
    total(): number {
      return Date.now() - t0
    },
  }
}
