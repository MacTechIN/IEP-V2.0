/**
 * 인지액·송달료 계산.
 *
 * ── **모델에게 시키지 않는다** ───────────────────────────────
 *
 * 지어낸 인지액이 붙은 소장은 보정명령을 받거나 각하될 수 있다.
 * 계산 규칙은 정해져 있으므로 **코드가 한다.** 모델은 문장을 쓰고, 숫자는 여기서 나온다.
 *
 * ── 근거와 그 한계 ──────────────────────────────────────────
 *
 * 아래 구간은 `docs/Complaint_template.md` 「3. 핵심 비즈니스 로직 룰」 에 적힌 것 그대로다.
 * **거기 없는 것은 지어내지 않았다** — 10억 이상 구간, 소액/단독 판단 기준이 그렇다.
 * 모르는 것은 `unknown` 으로 표시해 화면이 「확인 필요」 라고 말하게 한다.
 *
 * **이 값들은 법이 바뀌면 바뀐다.** 실제 제출 전에는 반드시 사람이 확인해야 하고,
 * 화면도 그렇게 말한다. 여기 숫자는 **초안을 위한 계산**이지 확정이 아니다.
 */

/** 1회 송달료. 템플릿 기준값. */
/** 소액사건의 소가 상한 (소액사건심판규칙 §1의2). */
export const SMALL_CLAIM_LIMIT = 30_000_000

export const SERVICE_FEE_PER_ROUND = 5200

/** 사건 종류별 송달 회수. 템플릿에 적힌 둘만 둔다. */
export const SERVICE_ROUNDS = { 소액: 10, 단독: 15 } as const
export type CaseScale = keyof typeof SERVICE_ROUNDS

export interface CostInput {
  /** 소가 (청구 원금). 원 단위 정수. */
  claimAmount: number
  /** 당사자 수 = 원고 + 피고 */
  partyCount: number
  /** 사건 규모. **모르면 넘기지 않는다** — 그러면 송달료가 `unknown` 이 된다. */
  scale?: CaseScale
  /** 전자소송이면 인지액 10% 감액 */
  electronic?: boolean
}

export interface CostResult {
  claimAmount: number
  /** 인지액. 구간을 벗어나면 null 이고 `notes` 가 이유를 말한다. */
  stampFee: number | null
  /** 전자소송 감액 전 금액. 비교용으로 남긴다. */
  stampFeeBeforeDiscount: number | null
  serviceFee: number | null
  totalCost: number | null
  /** **모르는 것을 모른다고 적는다.** 화면이 이걸 그대로 보여 준다. */
  notes: string[]
}

/**
 * 인지대.
 *
 * 템플릿의 구간:
 *   V < 1,000만        V × 0.005            (최소 1,000원)
 *   1,000만 ≤ V < 1억   V × 0.0045 + 5,000
 *   1억 ≤ V < 10억      V × 0.0040 + 55,000
 *
 * **10억 이상은 템플릿에 없다.** 지어내지 않고 `null` 을 낸다.
 * 100원 미만은 버린다(인지액 관행). 이 반올림 규칙도 템플릿에 없어 `notes` 에 적는다.
 */
/**
 * 정확한 내림 나눗셈.
 *
 * **왜 있는가.** `45,000,000 * 0.0045` 는 `202,499.99999999997` 이다.
 * 여기에 5,000을 더해 100원 단위로 버리면 **207,400원** — 정답은 207,500원이다.
 * 법원에 내는 돈이 100원 모자라면 보정명령이 온다.
 * 2026-08-26 검증에서 실제로 그렇게 계산된 초안이 나왔다.
 *
 * 그래서 **소수를 쓰지 않는다.** 비율을 분수로 두고 정수로만 센다.
 * 나눗셈 자체도 부동소수라 한 칸 모자랄 수 있어 되짚어 고친다.
 */
function floorDiv(a: number, b: number): number {
  const q = Math.floor(a / b)
  return (q + 1) * b <= a ? q + 1 : q
}

/**
 * 인지액. **구간마다 비율이 다르다** (민사소송 등 인지법 §2).
 *
 * 비율을 `0.0045` 가 아니라 `45/10000` 으로 둔다 — 곱셈이 정수로 끝나야
 * 100원 단위 절사가 정확해진다.
 */
export function stampFee(claimAmount: number): { fee: number | null; note?: string } {
  const V = Math.floor(claimAmount)
  if (!Number.isFinite(V) || V <= 0) return { fee: null, note: '소가가 없거나 0 이하입니다' }

  // [분자에 곱할 수, 분모, 더할 기본액]
  let num: number, den: number, base: number
  if (V < 10_000_000) { num = 50; den = 10_000; base = 0 }
  else if (V < 100_000_000) { num = 45; den = 10_000; base = 5_000 }
  else if (V < 1_000_000_000) { num = 40; den = 10_000; base = 55_000 }
  else {
    return {
      fee: null,
      note: '소가 10억원 이상은 참조 자료에 구간이 없습니다 — 인지액을 직접 확인하십시오',
    }
  }

  // 전부 분모를 곱해 정수로 올린 뒤 한 번에 나눈다. 중간에 소수가 생기지 않는다.
  const scaled = V * num + base * den
  // 100원 미만 절사. **관행이지 참조 자료에 적힌 규칙이 아니다** — 그래서 알린다.
  const fee = floorDiv(scaled, den * 100) * 100
  // 1천원이 최소액이다 (소가가 아주 작을 때).
  return { fee: Math.max(1000, fee) }
}

/** 송달료 = 당사자수 × 회수 × 1회 송달료. */
export function serviceFee(partyCount: number, scale?: CaseScale):
  { fee: number | null; note?: string } {
  if (!scale) {
    return {
      fee: null,
      note: '사건 규모(소액·단독)를 정해야 송달료가 계산됩니다 — 참조 자료에 판단 기준이 없어 직접 고르십시오',
    }
  }
  if (!Number.isFinite(partyCount) || partyCount < 2) {
    return { fee: null, note: '당사자가 둘(원고·피고) 이상이어야 합니다' }
  }
  return { fee: Math.floor(partyCount) * SERVICE_ROUNDS[scale] * SERVICE_FEE_PER_ROUND }
}

export function calcCosts(input: CostInput): CostResult {
  const notes: string[] = []
  const s = stampFee(input.claimAmount)
  if (s.note) notes.push(s.note)

  let fee = s.fee
  const before = fee
  if (fee != null && input.electronic) {
    // 전자소송 10% 감액. 100원 미만 절사는 감액 뒤에도 같게 둔다.
    fee = Math.floor((fee * 0.9) / 100) * 100
    notes.push('전자소송 10% 감액을 적용했습니다')
  }

  const sv = serviceFee(input.partyCount, input.scale)
  if (sv.note) notes.push(sv.note)

  // **사건 규모는 고르는 것이 아니라 소가로 정해진다.**
  // 소액사건은 소가 3,000만원 이하다(소액사건심판규칙 §1의2).
  // 화면에서는 그냥 고를 수 있어서, 5,000만원 사건에 「소액」 을 골라 두면
  // 송달료가 10회로 계산되어 **52,000원이 모자란 값**이 조용히 나온다.
  // 2026-08-26 에 실제로 그렇게 만들어진 초안이 있었다.
  if (input.scale === '소액' && input.claimAmount > SMALL_CLAIM_LIMIT) {
    notes.push(`⚠ 소가 ${input.claimAmount.toLocaleString()}원은 소액사건이 아닙니다 `
      + `(소액은 ${SMALL_CLAIM_LIMIT.toLocaleString()}원 이하). `
      + '「단독」 으로 바꾸십시오 — 지금 송달료는 회수가 모자랍니다.')
  }
  if (input.scale === '단독' && input.claimAmount > 0 && input.claimAmount <= SMALL_CLAIM_LIMIT) {
    notes.push(`소가 ${input.claimAmount.toLocaleString()}원은 소액사건에 해당할 수 있습니다 `
      + '— 「소액」 이면 송달료가 10회로 줄어듭니다.')
  }

  if (fee != null) notes.push('인지액은 100원 미만을 버렸습니다 (관행)')
  // **마지막에 못 박는다.** 이 줄이 없으면 계산값이 확정처럼 읽힌다.
  notes.push('이 금액은 초안을 위한 계산입니다. 제출 전에 반드시 확인하십시오.')

  return {
    claimAmount: Math.floor(input.claimAmount) || 0,
    stampFee: fee,
    stampFeeBeforeDiscount: before,
    serviceFee: sv.fee,
    totalCost: fee != null && sv.fee != null ? fee + sv.fee : null,
    notes,
  }
}
