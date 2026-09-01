// 민감 개인정보 비식별화 — **내보낼 때만** (021)
//
// ── 무엇을 가리고 무엇을 가리지 않나 ──────────────────────────
//
// **저장된 전사문은 가리지 않는다.** 그것은 증거다 — 마스킹해 두면 나중에
// "대상자이 실제로 뭐라고 했나" 를 되짚을 수 없고, 녹취의 값이 사라진다.
// 저장은 **접근 통제와 감사**로 지킨다(같은 마이그레이션).
//
// 가리는 것은 **밖으로 나가는 텍스트**다 — OpenAI 로 보내는 분석·코칭 프롬프트.
// 설계 결정(§8①)이 "외부 AI 를 그대로 쓰되 보호를 얹는다" 였고, 그 보호의 첫 겹이 이것이다.
//
// ── 과하게 가리면 분석이 죽는다 ───────────────────────────────
//
// **날짜와 금액은 절대 가리지 않는다.** 법률 분석의 핵심이 그것이다 —
// `2024-03-01 에 5,000만원` 을 가리면 시효도 요건도 계산할 수 없다.
// 그래서 정규식을 좁게 잡고, **날짜·금액이 살아남는지를 시험으로 못박아 두었다**
// (`tools/pii.test.mjs`).
//
// 이름은 가리지 않는다. 한국어 이름은 일반 명사와 구별되지 않아 정규식으로 잡으면
// 오탐이 쏟아지고, 무엇보다 **누가 무엇을 했는지가 사실관계 자체**다.

export type PiiKind = 'RRN' | 'PHONE' | 'CARD' | 'ACCOUNT' | 'EMAIL' | 'BIZNO'

export interface PiiMatch {
  kind: PiiKind
  original: string
  token: string
}

export interface MaskResult {
  text: string
  matches: PiiMatch[]
}

/**
 * 순서가 중요하다 — **좁은 것부터** 본다.
 * 주민번호를 전화번호 규칙이 먼저 먹으면 둘 다 틀린다.
 */
const RULES: { kind: PiiKind; re: RegExp }[] = [
  // 주민등록번호 — 뒤 첫자리가 1~4(내국인)·5~8(외국인)
  { kind: 'RRN', re: /\b\d{6}\s?[-–]\s?[1-8]\d{6}\b/g },
  // 사업자등록번호 — 3-2-5. **날짜(2024-03-01)와 자릿수가 달라 겹치지 않는다**
  { kind: 'BIZNO', re: /\b\d{3}\s?-\s?\d{2}\s?-\s?\d{5}\b/g },
  // 카드번호 — 4-4-4-4
  { kind: 'CARD', re: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g },
  { kind: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // 휴대전화 — 010/011/016~019 로 시작할 때만. **구분자를 요구한다** —
  // 요구하지 않으면 `01012345678` 같은 숫자 덩어리가 금액과 헷갈린다.
  { kind: 'PHONE', re: /\b01[016-9][\s-]\d{3,4}[\s-]\d{4}\b/g },
  // 계좌번호 — **은행 이름이나 '계좌' 라는 말이 앞에 있을 때만** 본다.
  // 문맥 없이 숫자 덩어리를 잡으면 금액·사건번호를 먹는다.
  {
    kind: 'ACCOUNT',
    re: /((?:은행|계좌|통장|입금|이체)\s*(?:번호)?\s*[:：]?\s*)(\d{2,6}[\s-]\d{2,6}[\s-]\d{2,7})/g,
  },
]

/**
 * 밖으로 내보낼 텍스트를 가린다.
 *
 * 되돌릴 수 있게 **원문↔치환의 대응을 함께 돌려준다.** 대응은 텍스트와 **분리 보관**한다 —
 * 같은 곳에 두면 가린 의미가 없다.
 */
export function maskPii(text: string): MaskResult {
  if (!text) return { text: '', matches: [] }
  const matches: PiiMatch[] = []
  const seen = new Map<string, string>()   // 같은 값은 같은 토큰으로. 동일인 판단이 가능해야 한다
  let out = text

  for (const { kind, re } of RULES) {
    out = out.replace(re, (whole, ...args) => {
      // ACCOUNT 만 앞 문맥을 캡처한다 — 그 부분은 남기고 번호만 가린다.
      const isAccount = kind === 'ACCOUNT'
      const prefix = isAccount ? String(args[0] ?? '') : ''
      const value = isAccount ? String(args[1] ?? '') : whole

      let token = seen.get(value)
      if (!token) {
        token = `[${kind}_${seen.size + 1}]`
        seen.set(value, token)
        matches.push({ kind, original: value, token })
      }
      return prefix + token
    })
  }
  return { text: out, matches }
}

/** 가린 것을 되돌린다. 화면에 원문을 보여 줄 때 쓴다 — 권한이 확인된 뒤에만. */
export function unmaskPii(text: string, matches: PiiMatch[]): string {
  let out = text
  for (const m of matches) out = out.split(m.token).join(m.original)
  return out
}
