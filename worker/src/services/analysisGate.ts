/**
 * 분석 결과를 덮어쓰기 **직전에** 한 번 통과시킨다 (2026-08-27).
 *
 * 계획서: docs/2026-08-27-분석-쓰기-안전-계획.md
 *
 * ## 왜 있는가
 *
 * 2026-08-27 하루에 다섯 건이 났고, 공통점이 하나였다 —
 * **결과가 명백히 잘못돼도 그대로 덮어쓴다. 아무도 안 막는다.**
 *
 *   · `recordingIds` 없이 재분석 → 멀쩡한 결과가 「분석된 녹음이 없습니다」 로 덮임
 *   · 역할 판정이 45명 중 0명 → `미상 8818단어` 가 그대로 저장
 *   · 화자 45명·이름이 기호(`화자 ]`) 인 채로 저장
 *
 * 뒤의 셋은 **아무도 몰랐다.** 사용자가 화면을 보고 알려 줘서 알았다.
 *
 * ## 판정은 셋뿐이다
 *
 *   BLOCK  덮지 않는다. 옛 결과가 남는다
 *   WARN   덮되, 무엇이 이상한지 적는다
 *   OK     그냥 덮는다
 *
 * ## BLOCK 을 좁게 잡는 것이 이 파일의 전부다
 *
 * 「이상해 보이면 막는다」 로 가면 **진짜 45명인 회의가 막힌다.**
 * BLOCK 은 「이건 결과가 아니다」 인 것만이다 — 없던 것으로 있던 것을 덮는 경우.
 * 나머지는 전부 WARN 이다. 이상한 것을 **막는 것보다 말하는 것**이 낫다.
 *
 * ## 순수 함수다
 *
 * DB 도 모델도 안 부른다. `(옛것, 새것) → 판정`.
 * 그래야 결함을 심어 시험할 수 있고, 실제로 그렇게 시험한다.
 */

/** 덮이기 전의 상태. 없으면 `null` — **첫 분석이다.** */
export interface Existing {
  segmentCount: number
  transcriptChars: number
  hasSummary: boolean
}

/** 이번에 쓰려는 것. */
export interface Incoming {
  segmentCount: number
  transcriptChars: number
  summary: string | null
  speakerLabels: string[]
  /** 역할별 집계의 키 (`변호사`·`의뢰인`·`미상`). 없으면 빈 배열 */
  roleKeys: string[]
  /** 구간 수와 이어진 연결 수. 겹침이 없으면 links 가 0이다 */
  parts?: number
  links?: number
  /** 발화 비율의 합. 1에서 크게 벗어나면 어디로 샌 것이다 */
  talkRatioSum?: number
}

export type Verdict = 'OK' | 'WARN' | 'BLOCK'
export interface GateResult {
  verdict: Verdict
  /** 사람이 읽을 이유. `analysis_note` 로 그대로 나간다 */
  reasons: string[]
}

/** 우리가 실패를 알리려고 만든 문구. **결과가 아니다.** */
const WARNING_PREFIX = '⚠️'

/** 이름에 있어도 되는 글자. 여기서 벗어나면 이름 만드는 코드가 깨진 것이다. */
const NAME_OK = /^[\p{Script=Hangul}A-Za-z0-9 ·:·()_-]+$/u

export function checkAnalysis(prev: Existing | null, next: Incoming): GateResult {
  const block: string[] = []
  const warn: string[] = []

  // ── BLOCK — 없던 것으로 있던 것을 덮는 경우만 ─────────────────
  //
  // **첫 분석은 절대 막지 않는다.** `prev` 가 없으면 지킬 옛것이 없다.
  // 게이트가 첫 분석을 막으면 제품이 안 돈다 — 「막는 시험」 만 짜면 이걸 놓친다.
  if (prev) {
    if (next.transcriptChars === 0 && prev.transcriptChars > 0) {
      block.push('새 분석에 전사문이 없는데 기존에는 있었습니다 — 덮지 않았습니다.')
    }
    if (next.segmentCount === 0 && prev.segmentCount >= 100) {
      block.push(`새 분석의 녹취가 0줄인데 기존은 ${prev.segmentCount}줄입니다 — 덮지 않았습니다.`)
    } else if (prev.segmentCount >= 100 && next.segmentCount < prev.segmentCount * 0.5) {
      block.push(`녹취가 ${prev.segmentCount}줄에서 ${next.segmentCount}줄로 줄었습니다 `
        + '— 전사가 반쯤 실패한 것으로 보아 덮지 않았습니다.')
    }
    if (prev.hasSummary && (next.summary ?? '').startsWith(WARNING_PREFIX)) {
      block.push('새 요약이 실패 안내 문구입니다 — 결과가 아니므로 덮지 않았습니다.')
    }
  }
  if (block.length) return { verdict: 'BLOCK', reasons: block }

  // ── WARN — 이상하지만 맞을 수도 있다 ─────────────────────────
  const n = next.speakerLabels.length
  if (n > 12) {
    warn.push(`화자가 ${n}명으로 잡혔습니다. 녹음이 여러 구간이고 구간 사이에 겹치는 부분이 `
      + '없으면 같은 사람이 구간마다 갈립니다 — 실제 인원이 아닐 수 있습니다.')
  }
  if ((next.parts ?? 0) > 1 && next.links === 0 && n > 2) {
    warn.push(`구간 ${next.parts}개 사이에 겹치는 부분이 없어 같은 사람을 구간 너머로 `
      + '잇지 못했습니다.')
  }
  const realRoles = next.roleKeys.filter((k) => k !== '미상')
  if (next.roleKeys.length > 0 && realRoles.length === 0) {
    warn.push('역할(변호사·의뢰인)을 하나도 판정하지 못했습니다 — 대화 지표가 전부 「미상」 입니다.')
  }
  const badName = next.speakerLabels.find((l) => l && !NAME_OK.test(l))
  if (badName) {
    warn.push(`화자 이름에 이상한 글자가 있습니다 (${badName}) — 이름을 만드는 곳을 확인하십시오.`)
  }
  if (next.talkRatioSum !== undefined && next.talkRatioSum > 0 && next.talkRatioSum < 0.9) {
    warn.push(`발화 비율의 합이 ${Math.round(next.talkRatioSum * 100)}% 입니다 `
      + '— 나머지가 어디로 갔는지 확인이 필요합니다.')
  }

  return warn.length ? { verdict: 'WARN', reasons: warn } : { verdict: 'OK', reasons: [] }
}
