/**
 * 이름 정규화 — **이해충돌 검사가 여기 달려 있다.**
 *
 * 표기가 다르다고 못 찾으면 검사를 안 한 것과 같고, 그건 수임 자체가 문제가 되는 종류다.
 * 그래서 실제로 쓰이는 표기를 전부 같은 값으로 만드는지 못박는다.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// **경로를 CWD 에 기대지 않는다** — 저장소 뿌리에서 부르면 못 찾고 터진다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const dir = join(ROOT, 'node_modules', '.sep-test');
mkdirSync(dir, { recursive: true });
const out = join(dir, 'matters.mjs');
await build({ entryPoints: [join(ROOT, 'src/services/matters.ts')], bundle: true, format: 'esm',
              platform: 'node', outfile: out, logLevel: 'silent',
              external: ['pg'] });
const { normalizeName } = await import(out);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✘'} ${m}`); if (!c) fail++; };

console.log('\n── 같은 회사로 봐야 하는 것 ──');
const 같음 = ['주식회사 다라', '㈜다라', '다라(주)', '다라 (주)', '다라주식회사', '다 라'];
const base = normalizeName('주식회사 다라');
for (const n of 같음) ok(normalizeName(n) === base, `${n} → ${normalizeName(n)}`);

console.log('\n── 유한회사·법인 ──');
ok(normalizeName('유한회사 마바') === normalizeName('마바(유)'), '유한회사 = (유)');
ok(normalizeName('재단법인 사공') === normalizeName('사공(재)'), '재단법인 = (재)');

console.log('\n── **다른 회사는 달라야 한다** ──');
ok(normalizeName('주식회사 다라') !== normalizeName('주식회사 다라전자'),
   '다라 ≠ 다라전자 (너무 뭉개면 엉뚱한 충돌이 뜬다)');
ok(normalizeName('김철수') !== normalizeName('김철수영'), '김철수 ≠ 김철수영');

console.log('\n── 사람 이름 ──');
ok(normalizeName('박 상철') === normalizeName('박상철'), '공백만 다른 사람 이름은 같다');

console.log('\n── 빈 값 ──');
ok(normalizeName('') === '', '빈 문자열');
ok(normalizeName('   ') === '', '공백만');

if (fail) { console.log(`\n✘ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ 이름 정규화 통과');
