/**
 * 구간 겹침 정렬 — 같은 사람을 잇고, 두 번 실린 발화를 버리는가.
 *
 * **소스를 그대로 불러서** 확인한다. 규칙을 여기 다시 적으면 코드가 되돌아가도 시험은 통과한다.
 *
 * 이 시험이 지켜야 하는 것은 둘이다.
 *   1. 이어야 할 것을 잇는가
 *   2. **이으면 안 되는 것을 안 잇는가** ← 이쪽이 더 중요하다.
 *      잘못 이으면 다른 사람 말이 한 사람 것으로 뭉치고 그 위의 평가가 통째로 틀린다.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join('node_modules', '.sep-test');
mkdirSync(dir, { recursive: true });
const out = join(process.cwd(), dir, 'speaker-merge.mjs');
await build({
  entryPoints: ['src/services/speakerMerge.ts'], bundle: true, format: 'esm',
  platform: 'node', outfile: out, logLevel: 'silent',
});
const { mergeSpeakers, alignOverlap, alignKey, letters } = await import(out);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✘'} ${msg}`); if (!cond) fail++; };

const seg = (speaker, start_ms, text) => ({ speaker, start_ms, end_ms: start_ms + 3000, text });
const OVERLAP = 15000;

// 파트 하나를 만든다. 끝 15초에 겹침 발화를 둔다.
const part = (segs) => ({ id: 'r', segments: segs });

console.log('\n── 이어야 할 것을 잇는가 ──');
{
  // 파트1: A 가 길게 말하고 끝에 겹침 구간
  const p1 = part([
    seg('A', 0, '오늘은 보안링스 고도화 일정을 확인하려고 합니다'),
    seg('B', 300000, '네 저희도 그 부분이 가장 궁금했습니다'),
    // ↓ 겹침 구간 (끝 15초). 파트2 앞머리에 같은 말이 다시 나온다
    seg('A', 585000, '그러면 다음 주까지 소스 이전을 마치는 것으로 하겠습니다'),
    seg('B', 592000, '좋습니다 그 일정이면 저희도 준비가 됩니다'),
  ]);
  // 파트2: 같은 두 사람인데 STT 가 이름을 새로 매겼다 (A→B, B→A 로 뒤집힘)
  const p2 = part([
    seg('B', 0, '그러면 다음 주까지 소스 이전을 마치는 것으로 하겠습니다'),
    seg('A', 7000, '좋습니다 그 일정이면 저희도 준비가 됩니다'),
    seg('B', 60000, '그리고 통신판매업 신고도 같이 진행하겠습니다'),
  ]);

  const r = mergeSpeakers([p1, p2], { overlapMs: OVERLAP });
  ok(r.before === 4, `격리하면 화자 4명 (실제 값 ${r.before})`);
  ok(r.after === 2, `이으면 2명 (실제 값 ${r.after})`);
  ok(r.links === 2, `연결 2개 (실제 값 ${r.links})`);

  // 뒤집힌 것을 제대로 이었는가 — P1:A 와 P2:B 가 같은 그룹이어야 한다
  const g = (id) => r.groupOf.get(id);
  ok(g('P1:A') === g('P2:B'), 'P1:A 와 P2:B 가 같은 사람 (이름이 뒤집혀도 잇는다)');
  ok(g('P1:B') === g('P2:A'), 'P1:B 와 P2:A 가 같은 사람');
  ok(g('P1:A') !== g('P1:B'), '서로 다른 사람은 안 합친다');

  // 겹쳐서 두 번 실린 발화는 뒤 구간에서 버린다
  const drop = r.dropped.get(1);
  ok(drop && drop.has(0) && drop.has(1), '겹친 발화 2개를 뒤 구간에서 버린다');
  ok(drop && !drop.has(2), '겹치지 않은 발화는 남긴다');
}

console.log('\n── 이으면 안 되는 것을 안 잇는가 ──');
{
  // 맞장구만 같다. `네.` 는 어디에나 있으므로 근거가 될 수 없다.
  const p1 = part([
    seg('A', 0, '가격은 이렇게 됩니다'),
    seg('B', 590000, '네'),
  ]);
  const p2 = part([
    seg('A', 0, '네'),
    seg('B', 60000, '전혀 다른 이야기를 합니다'),
  ]);
  const r = mergeSpeakers([p1, p2], { overlapMs: OVERLAP });
  ok(r.links === 0, `맞장구만으로는 잇지 않는다 (연결 ${r.links}개)`);
  ok(r.after === 4, `근거가 없으면 갈린 채로 둔다 (화자 ${r.after}명)`);
  ok(r.dropped.get(1)?.has(0) === true, '그래도 중복된 `네` 는 버린다 (화자는 안 잇지만)');
}
{
  // 겹침이 아예 없는 옛 녹음 — 아무것도 이어지면 안 된다
  const p1 = part([seg('A', 0, '완전히 다른 내용입니다 앞 구간'), seg('B', 300000, '두 번째 사람 발화')]);
  const p2 = part([seg('A', 0, '완전히 다른 내용입니다 뒤 구간'), seg('B', 60000, '또 다른 발화')]);
  const r = mergeSpeakers([p1, p2], { overlapMs: OVERLAP });
  ok(r.links === 0, `겹침이 없으면 잇지 않는다 (연결 ${r.links}개)`);
  ok(r.after === 4, `격리 상태 그대로 (화자 ${r.after}명)`);
}
{
  // 같은 말을 서로 다른 두 사람이 한 경우 — 화자가 갈리므로 근거로 쓰면 안 된다
  const same = '그러면 그렇게 진행하는 것으로 하겠습니다';
  const p1 = part([seg('A', 585000, same), seg('B', 590000, same)]);
  const p2 = part([seg('C', 0, same)]);
  const r = mergeSpeakers([p1, p2], { overlapMs: OVERLAP });
  ok(r.links === 0, `같은 말을 여럿이 했으면 잇지 않는다 (연결 ${r.links}개)`);
}

console.log('\n── 등록 실명 ──');
{
  const p1 = part([seg('김현진', 585000, '그러면 다음 주까지 마무리하겠습니다'), seg('A', 100, '알겠습니다')]);
  const p2 = part([seg('김현진', 0, '그러면 다음 주까지 마무리하겠습니다'), seg('B', 60000, '네 확인했습니다')]);
  const r = mergeSpeakers([p1, p2], { overlapMs: OVERLAP, globalNames: new Set(['김현진']) });
  ok(r.groupOf.get('김현진') === r.groupOf.get('김현진'), '실명은 격리하지 않는다');
  ok(r.labelOf.get(r.groupOf.get('김현진')) === '김현진', '실명이 그대로 화면 이름이 된다');
  ok(!r.groupOf.has('P1:김현진'), '실명에 구간 접두어가 붙지 않는다');
}

console.log('\n── 중간 구간은 겹치지 않는다 ──');
{
  // 겹침은 이웃한 구간 사이에만 생긴다. 파트1 가운데 말이 파트3 앞과 같아도 이으면 안 된다.
  const line = '이 문장은 회의 내내 반복되는 상투어입니다';
  const p1 = part([seg('A', 100000, line)]);            // 가운데 — 겹침 창 밖
  const p2 = part([seg('B', 200000, '무관한 말')]);
  const p3 = part([seg('C', 0, line)]);
  const r = mergeSpeakers([p1, p2, p3], { overlapMs: OVERLAP });
  ok(r.links === 0, `겹침 창 밖의 일치는 무시한다 (연결 ${r.links}개)`);
}

console.log('\n── 정규화 ──');
ok(alignKey('네, 좋습니다.') === alignKey('네 좋습니다'), '문장부호·공백 차이는 같은 말로 본다');
ok(alignKey('') === '', '빈 문자열은 빈 값');

// ── 화자가 26명을 넘으면 (2026-08-27 실측) ──
//
// 옛 판은 `String.fromCharCode(65 + n)` 이었다. 26을 넘으면 알파벳이 아니라
// `[`·`\`·`]`·`^`·`_`·`` ` ``·`a` 가 나온다. 화면에 「화자 ]」·「화자 `」 가 떴고,
// 사람은 그것을 **글자 깨짐**으로 읽어 진짜 문제(구간을 못 이었다)를 놓친다.
console.log('\n── 이름이 26명을 넘어도 이름인가 ──');
for (const [n, want] of [[0,'A'],[1,'B'],[25,'Z'],[26,'AA'],[27,'AB'],[44,'AS'],[51,'AZ'],[52,'BA'],[701,'ZZ'],[702,'AAA']]) {
  ok(letters(n) === want, `${n}번째 → ${want} (받은 값 ${letters(n)})`);
}
{
  // **기호가 하나라도 섞이면 그 자리에서 잡는다.**
  let bad = null;
  for (let n = 0; n < 500; n++) if (!/^[A-Z]+$/.test(letters(n))) { bad = n; break; }
  ok(bad === null, bad === null ? '0~499번째가 전부 영문 대문자다' : `${bad}번째가 «${letters(bad)}»`);
  // **이름이 겹치면 지표가 두 사람을 합친다.**
  const seen = new Set(); let dup = null;
  for (let n = 0; n < 500; n++) { const L = letters(n); if (seen.has(L)) { dup = L; break; } seen.add(L); }
  ok(dup === null, dup === null ? '500명까지 이름이 겹치지 않는다' : `«${dup}» 가 두 번 나온다`);
}

if (fail) { console.log(`\n✘ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ 겹침 정렬 통과');
