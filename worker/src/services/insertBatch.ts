/**
 * 여러 줄을 **한 문장으로** 넣는다 (2026-08-27).
 *
 * ## 왜 있는가
 *
 * 전사 세그먼트를 한 줄씩 `insert` 하고 있었다. 1027줄짜리 미팅을 다시 분석하면
 * **왕복이 1027번**이고, 실측으로 그 단계에만 5분 넘게 걸렸다.
 * 그 사이 화면에는 전사가 반쯤 빈 채로 보인다(739 → 936 → 1027).
 *
 * ## 왜 200줄인가
 *
 * Postgres 한 문장의 파라미터 상한은 **65535개**다. 열이 8개면 8191줄까지 되지만,
 * 한 문장이 커질수록 실패했을 때 **무엇 때문인지 알기 어려워진다.**
 * 200줄이면 1027줄이 여섯 문장이고, 파라미터는 1600개로 상한의 2.4% 다.
 *
 * ## 순수 함수다
 *
 * DB 를 모른다. SQL 문자열과 값 배열만 만든다 —
 * **그래야 결함을 심어 시험할 수 있다.** 실제로 Postgres 가 받는지는 따로 확인한다.
 */

/** 한 문장에 담는 줄 수. 파라미터 상한(65535)에서 한참 아래다. */
export const BATCH_ROWS = 200

/**
 * `rows` 는 **열 순서가 같은** 값 배열들이다. 줄마다 길이가 다르면 SQL 이 깨지므로
 * 여기서 막는다 — 조용히 어긋난 문장을 만들어 보내는 것이 제일 나쁘다.
 */
export function insertBatches(
  rows: unknown[][],
  table = 'v2.transcript_segments',
  cols = ['meeting_id', 'speaker_label', 'speaker_id', 'content',
          'start_ms', 'end_ms', 'sort_order', 'recording_id'],
  chunk = BATCH_ROWS,
): Array<[string, unknown[]]> {
  if (!rows.length) return []
  const n = cols.length
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== n) {
      throw new Error(`insertBatches: ${i}번째 줄의 값이 ${rows[i].length}개인데 열은 ${n}개입니다`)
    }
  }
  const out: Array<[string, unknown[]]> = []
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const values: unknown[] = []
    const tuples = slice.map((row, k) => {
      values.push(...row)
      const base = k * n
      return `(${Array.from({ length: n }, (_, j) => `$${base + j + 1}`).join(',')})`
    })
    out.push([`insert into ${table} (${cols.join(', ')}) values ${tuples.join(',')}`, values])
  }
  return out
}
