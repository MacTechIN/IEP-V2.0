/**
 * 인지액·송달료 — **돈이 걸린 계산이라 시험이 먼저다.**
 *
 * 지어낸 인지액이 붙은 소장은 보정명령을 받거나 각하될 수 있다.
 * 그래서 이 계산은 모델이 아니라 코드가 하고, 코드는 여기서 못박는다.
 *
 * 확인하는 것
 *   1. 템플릿의 세 구간이 경계에서 정확히 갈리는가
 *   2. **모르는 것을 null 로 내는가** — 10억 이상, 규모 미지정.
 *      틀린 숫자를 내는 것보다 「모른다」 가 낫다
 *   3. 전자소송 감액
 *   4. 계산값이 확정처럼 읽히지 않게 경고가 붙는가
 *
 * 실행: node worker/tools/costs.test.mjs
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(ROOT, 'node_modules', '.sep-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'costs.mjs')
await build({
  entryPoints: [join(ROOT, 'src/services/documents/costs.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const { stampFee, serviceFee, calcCosts } = await import(out)

let fail = 0
const ok = (c, m, d = '') => { console.log(`  ${c ? '✓' : '✘'} ${m}${d ? ' — ' + d : ''}`); if (!c) fail++ }
const eq = (a, b, m) => ok(a === b, m, `받은 값 ${a} · 기대 ${b}`)

console.log('\n── 인지액: 템플릿의 세 구간 ──')
// V < 1000만 : V*0.005, 최소 1000원
eq(stampFee(1_000_000).fee, 5000, '100만원 → 0.5%')
// 10만원 × 0.5% = 500원 → **최소 1,000원이 적용된다** (템플릿 명시)
eq(stampFee(100_000).fee, 1000, '10만원 → 1,000원 (계산값 500원에 최소액 적용)')
eq(stampFee(300_000).fee, 1500, '30만원 → 1,500원 (최소액을 넘으므로 그대로)')

console.log('\n── **템플릿의 예시로 검산한다** ──')
// docs/Complaint_template.md 의 Response 예시:
//   claimAmount 10,000,000 · stampFee 45,000 · serviceFee 104,000 · totalCost 149,000
// 규칙대로면 인지액은 50,000 인데 예시는 45,000 이다 — **전자소송 10% 감액이 적용된 값**이다.
// 우리 계산이 그 예시를 그대로 재현하는지 본다. 재현 못 하면 둘 중 하나가 틀린 것이다.
{
  const r = calcCosts({ claimAmount: 10_000_000, partyCount: 2, scale: '소액', electronic: true })
  eq(r.stampFee, 45_000, '인지액 45,000 (템플릿 예시와 일치)')
  eq(r.serviceFee, 104_000, '송달료 104,000 (템플릿 예시와 일치)')
  eq(r.totalCost, 149_000, '합계 149,000 (템플릿 예시와 일치)')
}

console.log('\n── 경계값 (여기가 틀리기 쉽다) ──')
eq(stampFee(9_999_999).fee, Math.floor((9_999_999 * 0.005) / 100) * 100, '999만9999원 — 1구간 끝')
eq(stampFee(10_000_000).fee, Math.floor((10_000_000 * 0.0045 + 5000) / 100) * 100, '1000만원 — 2구간 시작')
eq(stampFee(99_999_999).fee, Math.floor((99_999_999 * 0.0045 + 5000) / 100) * 100, '9999만9999원 — 2구간 끝')
eq(stampFee(100_000_000).fee, Math.floor((100_000_000 * 0.004 + 55_000) / 100) * 100, '1억원 — 3구간 시작')

console.log('\n── **모르는 것은 모른다고 한다** ──')
ok(stampFee(1_000_000_000).fee === null, '10억원 → null (템플릿에 구간이 없다)')
ok(/10억원 이상/.test(stampFee(1_000_000_000).note || ''), '  왜 null 인지 말한다')
ok(stampFee(0).fee === null, '소가 0 → null')
ok(stampFee(-1).fee === null, '음수 → null')
ok(serviceFee(2).fee === null, '규모를 안 정하면 송달료 null')
ok(/직접 고르십시오/.test(serviceFee(2).note || ''), '  무엇을 해야 하는지 말한다')

console.log('\n── 송달료 ──')
eq(serviceFee(2, '소액').fee, 2 * 10 * 5200, '당사자 2 · 소액 10회')
eq(serviceFee(3, '단독').fee, 3 * 15 * 5200, '당사자 3 · 단독 15회')
ok(serviceFee(1, '소액').fee === null, '당사자 1명 → null (원고·피고가 있어야 한다)')

console.log('\n── 전자소송 감액 ──')
{
  const plain = calcCosts({ claimAmount: 10_000_000, partyCount: 2, scale: '소액' })
  const elec = calcCosts({ claimAmount: 10_000_000, partyCount: 2, scale: '소액', electronic: true })
  ok(elec.stampFee < plain.stampFee, '전자소송이 더 싸다', `${plain.stampFee} → ${elec.stampFee}`)
  eq(elec.stampFee, Math.floor((plain.stampFee * 0.9) / 100) * 100, '10% 감액 · 100원 절사')
  eq(elec.stampFeeBeforeDiscount, plain.stampFee, '감액 전 금액도 남긴다')
  eq(elec.totalCost, elec.stampFee + elec.serviceFee, '합계 = 인지 + 송달')
}

console.log('\n── 확정처럼 읽히지 않게 ──')
{
  const r = calcCosts({ claimAmount: 10_000_000, partyCount: 2, scale: '소액' })
  ok(r.notes.some((n) => /제출 전에 반드시 확인/.test(n)), '반드시 확인하라는 문구가 있다')
  const unknown = calcCosts({ claimAmount: 2_000_000_000, partyCount: 2 })
  ok(unknown.totalCost === null, '하나라도 모르면 합계도 null — 반쪽 합계를 내지 않는다')
}


// ── 사건 규모가 소가와 어긋나는 경우 (2026-08-26 실측 사고) ──
//
// 화면에서 「소액」 은 그냥 고를 수 있다. 5,000만원 사건에 골라 두면
// 송달료가 15회가 아니라 10회로 계산되어 52,000원이 모자란 값이 조용히 나온다.
console.log('\n── 사건 규모가 소가와 어긋날 때 ──')
{
  const r = calcCosts({ claimAmount: 50_000_000, partyCount: 2, scale: '소액', electronic: false })
  const warned = r.notes.some((n) => n.includes('소액사건이 아닙니다'))
  ok(warned === true, '소가 5,000만 + 「소액」 → 경고한다')
  ok(r.serviceFee === 5200 * 10 * 2, '  경고해도 계산은 고른 대로 한다 (몰래 바꾸지 않는다)')

  const wide = calcCosts({ claimAmount: 50_000_000, partyCount: 2, scale: '단독', electronic: false })
  ok(wide.notes.some((n) => n.includes('소액사건이 아닙니다')) === false, '  「단독」 으로 바꾸면 경고가 없다')
  ok(wide.serviceFee === 5200 * 15 * 2, '  그때 송달료는 15회')
  ok(wide.serviceFee - r.serviceFee === 52_000, '  둘의 차이')

  const small = calcCosts({ claimAmount: 20_000_000, partyCount: 1, scale: '단독', electronic: false })
  ok(small.notes.some((n) => n.includes('소액사건에 해당할 수 있습니다')) === true, '소가 2,000만 + 「단독」 → 소액일 수 있다고 알린다')
}


// ── 부동소수 오차로 100원이 모자라던 것 (2026-08-26 실측) ──
//
// `45,000,000 * 0.0045` 는 `202,499.99999999997` 이다. 5,000을 더해 100원 단위로
// 버리면 207,400원 — 정답은 207,500원. **법원에 낼 돈이 100원 모자라면 보정명령이 온다.**
// 그래서 비율을 소수가 아니라 분수로 두고 정수로만 센다.
console.log('\n── 100원 단위가 정확한가 (부동소수) ──')
{
  const cases = [
    [45_000_000, 207_500, '4,500만원 — 소수식이면 207,400 이 나왔다'],
    [50_000_000, 230_000, '5,000만원 — 소수식이면 229,900'],
    [10_000_000,  50_000, '1억 미만 구간의 시작'],
    [ 9_999_999,  49_900, '1천만원 바로 아래 (다른 구간)'],
    [100_000_000, 455_000, '1억 — 세 번째 구간의 시작'],
  ]
  for (const [v, want, why] of cases) {
    ok(stampFee(v).fee === want, `소가 ${v.toLocaleString()} → ${want.toLocaleString()}원`,
       `${why} · 받은 값 ${stampFee(v).fee?.toLocaleString()}`)
  }
  // **구간 경계에서 값이 거꾸로 가면 안 된다.** 소가가 커지는데 인지액이 줄면 사고다.
  let prev = 0, mono = true
  for (let v = 100_000; v < 300_000_000; v += 137_000) {
    const f = stampFee(v).fee
    if (f !== null && f < prev) { mono = false; break }
    if (f !== null) prev = f
  }
  ok(mono, '소가가 커지면 인지액도 커진다 (구간 경계 포함, 2,189개 지점)')
}

console.log(fail ? `\n✘ ${fail}건 실패` : '\n✓ 인지액·송달료 통과 — 모르는 것은 null 로 낸다')
process.exit(fail ? 1 : 0)

