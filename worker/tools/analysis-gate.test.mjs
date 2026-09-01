#!/usr/bin/env node
/**
 * 게이트가 **무엇을 막고 무엇을 통과시키는지** 본다.
 *
 * 이 시험의 절반은 「막는가」 가 아니라 **「안 막아야 할 것을 안 막는가」** 다.
 * 게이트가 첫 분석을 막으면 제품이 안 돈다 — 막는 시험만 짜면 그걸 놓친다.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = join(tmpdir(), 'lep-gate-test'); mkdirSync(dir, { recursive: true })
const out = join(dir, 'gate.mjs')
await build({ entryPoints: ['src/services/analysisGate.ts'], outfile: out,
              bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' })
const { checkAnalysis } = await import(out)

let fail = 0
const ok = (c, m, d = '') => { console.log(`  ${c ? '✓' : '✘'} ${m}${d ? ` — ${d}` : ''}`); if (!c) fail++ }

const PREV = { segmentCount: 1027, transcriptChars: 40000, hasSummary: true }
const GOOD = {
  segmentCount: 1027, transcriptChars: 40000, summary: '상담 요약입니다',
  speakerLabels: ['변호사', '의뢰인'], roleKeys: ['변호사', '의뢰인'],
  parts: 8, links: 7, talkRatioSum: 1,
}
/**
 * **던져도 계속 돈다.**
 *
 * 게이트가 예외로 죽으면 그 자리에서 시험이 끝나고 **뒤의 것이 하나도 안 돈다** —
 * 무엇이 깨졌는지 목록으로 못 본다. 던진 것도 「실패한 판정」 으로 받아 적는다.
 * (2026-08-27: `if (prev)` 를 `if (true)` 로 바꿔 심었더니 첫 검사에서 터져
 *  나머지 스무 개가 안 돌았다.)
 */
const V = (prev, over = {}) => {
  try { return checkAnalysis(prev, { ...GOOD, ...over }) }
  catch (e) { return { verdict: 'THREW', reasons: [String(e && e.message)] } }
}

console.log('── 막아야 하는 것 (BLOCK) ──')
ok(V(PREV, { transcriptChars: 0, segmentCount: 0 }).verdict === 'BLOCK',
   '전사문이 비었는데 기존에는 있었다 — 2026-08-27 사고 1')
ok(V(PREV, { segmentCount: 0 }).verdict === 'BLOCK', '녹취가 0줄인데 기존은 1027줄')
ok(V(PREV, { segmentCount: 400 }).verdict === 'BLOCK', '녹취가 절반 미만으로 줄었다 (1027 → 400)')
ok(V(PREV, { summary: '⚠️ 분석된 녹음(전사문)이 없어 미팅 제목만으로 분석되었습니다.' }).verdict === 'BLOCK',
   '새 요약이 우리가 만든 실패 안내 문구다')
ok(V(PREV, { transcriptChars: 0, segmentCount: 0 }).reasons[0].includes('덮지 않았습니다'),
   '  왜 안 덮었는지 말한다')

console.log('\n── **막으면 안 되는 것** (여기가 이 시험의 핵심) ──')
ok(V(null).verdict === 'OK', '첫 분석은 통과한다 (지킬 옛것이 없다)', V(null).verdict)
ok(V(null).verdict !== 'THREW', '  첫 분석에서 던지지 않는다 (prev 가 null 이다)', V(null).reasons[0] || '')
ok(V(null, { transcriptChars: 0, segmentCount: 0, summary: '⚠️ 녹음이 없습니다' }).verdict !== 'BLOCK',
   '**첫 분석은 비어 있어도 안 막는다** — 막을 옛것이 없다')
ok(V({ segmentCount: 3, transcriptChars: 50, hasSummary: true }, { segmentCount: 2 }).verdict !== 'BLOCK',
   '기존이 작으면(3줄) 줄어든 것으로 막지 않는다 — 짧은 미팅이 있다')
ok(V(PREV, { segmentCount: 1027, speakerLabels: Array.from({ length: 45 }, (_, i) => `화자 ${i}`) }).verdict === 'WARN',
   '화자 45명은 **막지 않고** 알린다 — 진짜 45명인 회의가 있다')
ok(V(PREV, { segmentCount: 900 }).verdict === 'OK', '조금 줄어든 것(1027→900)은 통과한다')

console.log('\n── 알려야 하는 것 (WARN) ──')
{
  const r = V(PREV, { speakerLabels: Array.from({ length: 45 }, (_, i) => `화자 ${i}`) })
  ok(r.verdict === 'WARN' && r.reasons.some((x) => x.includes('45명')), '화자가 너무 많다')
  ok(r.reasons.some((x) => x.includes('실제 인원이 아닐 수')), '  실제 인원이 아닐 수 있다고 말한다')
}
ok(V(PREV, { roleKeys: ['미상'] }).reasons.some((x) => x.includes('역할')),
   '역할을 하나도 판정 못 했다 — 2026-08-27 사고 3 (미상 8818단어)')
ok(V(PREV, { speakerLabels: ['화자 A', '화자 ]', '화자 `'] }).reasons.some((x) => x.includes('이상한 글자')),
   '이름에 기호가 들어갔다 — 2026-08-27 사고 5')
ok(V(PREV, { parts: 8, links: 0, speakerLabels: ['a', 'b', 'c'] }).reasons.some((x) => x.includes('겹치는 부분이 없어')),
   '구간이 여럿인데 하나도 못 이었다')
ok(V(PREV, { talkRatioSum: 0.2 }).reasons.some((x) => x.includes('발화 비율')), '발화 비율의 합이 모자란다')
ok(V(PREV, { roleKeys: ['변호사', '의뢰인', '미상'] }).verdict === 'OK',
   '미상이 섞여 있어도 진짜 역할이 있으면 통과한다')

console.log('\n── 이름에 들어가도 되는 것 ──')
for (const nm of ['변호사', '의뢰인', '화자 A', '화자 AS', '구간 2 · 고객', '홍길동', 'John Doe'])
  ok(V(PREV, { speakerLabels: [nm] }).reasons.every((x) => !x.includes('이상한 글자')), `«${nm}» 는 정상`)

console.log(fail ? `\n✘ ${fail}건 실패` : '\n✓ 게이트 통과 — 막을 것만 막고, 첫 분석은 안 막는다')
process.exit(fail ? 1 : 0)
