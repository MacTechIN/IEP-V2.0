/**
 * 비식별화 — 가릴 것을 가리고, **가리면 안 되는 것을 안 가리는가.**
 *
 * 뒤쪽이 더 중요하다. 날짜와 금액을 가리면 법률 분석이 통째로 죽는다 —
 * `2024-03-01 에 5,000만원` 을 가리면 시효도 요건도 계산할 수 없다.
 * 그래서 **살아남아야 하는 것**을 시험으로 못박는다.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join('node_modules', '.sep-test');
mkdirSync(dir, { recursive: true });
const out = join(process.cwd(), dir, 'pii.mjs');
await build({ entryPoints: ['src/lib/pii.ts'], bundle: true, format: 'esm',
              platform: 'node', outfile: out, logLevel: 'silent' });
const { maskPii, unmaskPii } = await import(out);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✘'} ${m}`); if (!c) fail++; };

console.log('\n── 가려야 하는 것 ──');
{
  const t = '의뢰인 주민번호는 900101-1234567 입니다.';
  const r = maskPii(t);
  ok(!r.text.includes('900101-1234567'), '주민등록번호를 가린다');
  ok(r.matches[0]?.kind === 'RRN', `종류가 RRN (${r.matches[0]?.kind})`);
}
{
  const r = maskPii('연락처는 010-1234-5678 이고 메일은 kim@example.com 입니다.');
  ok(!r.text.includes('010-1234-5678'), '휴대전화를 가린다');
  ok(!r.text.includes('kim@example.com'), '이메일을 가린다');
}
{
  const r = maskPii('국민은행 계좌 123-456-789012 로 보냈습니다.');
  ok(!r.text.includes('123-456-789012'), '계좌번호를 가린다');
  ok(r.text.includes('계좌'), '앞의 문맥("계좌")은 남긴다 — 무엇을 가렸는지 알아야 한다');
}
{
  const r = maskPii('카드 1234-5678-9012-3456 로 결제했습니다.');
  ok(!r.text.includes('1234-5678-9012-3456'), '카드번호를 가린다');
}
{
  const r = maskPii('사업자등록번호 123-45-67890 입니다.');
  ok(r.matches[0]?.kind === 'BIZNO', `사업자등록번호를 가린다 (${r.matches[0]?.kind})`);
}

console.log('\n── **가리면 안 되는 것** ──');
{
  const t = '2024년 3월 1일에 차용증을 쓰고 2024-03-01 에 5,000만원을 입금했습니다. '
          + '변제기는 2024-05-01 이고 지연손해금은 연 12% 입니다.';
  const r = maskPii(t);
  ok(r.text.includes('2024-03-01'), '날짜(2024-03-01)가 살아남는다');
  ok(r.text.includes('2024-05-01'), '변제기 날짜가 살아남는다');
  ok(r.text.includes('5,000만원'), '금액(5,000만원)이 살아남는다');
  ok(r.text.includes('12%'), '이율이 살아남는다');
  ok(r.matches.length === 0, `가린 것이 없어야 한다 (실제 ${r.matches.length}건)`);
}
{
  const r = maskPii('사건번호 2024가단12345 이고 500만원을 받았습니다.');
  ok(r.matches.length === 0, '사건번호와 금액을 건드리지 않는다');
}
{
  // 사람 이름은 가리지 않는다 — 누가 무엇을 했는지가 사실관계 자체다
  const r = maskPii('박상철이 김의뢰에게 5천만원을 빌렸습니다.');
  ok(r.matches.length === 0, '사람 이름을 가리지 않는다 (사실관계가 사라진다)');
}

console.log('\n── 되돌릴 수 있는가 ──');
{
  const t = '주민번호 900101-1234567, 연락처 010-1234-5678.';
  const r = maskPii(t);
  ok(unmaskPii(r.text, r.matches) === t, '가린 것을 원문으로 되돌린다');
}
{
  // 같은 값은 같은 토큰이어야 한다 — 동일인 판단이 가능해야 하기 때문이다
  const r = maskPii('010-1111-2222 로 걸었고 다시 010-1111-2222 로 걸었습니다.');
  ok(r.matches.length === 1, `같은 번호는 토큰 하나 (실제 ${r.matches.length}건)`);
  const tok = r.matches[0].token;
  ok(r.text.split(tok).length - 1 === 2, '같은 토큰이 두 번 나타난다');
}

if (fail) { console.log(`\n✘ ${fail}개 실패`); process.exit(1); }
console.log('\n✓ 비식별화 통과');
