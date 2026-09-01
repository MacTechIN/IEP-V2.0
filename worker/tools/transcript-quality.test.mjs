/**
 * 녹취 품질 — 반복 루프가 접히나, 언어가 고정되나. (v2)
 *
 * 2026-08-20 신고(한국어 회의에 영어 구간 · 같은 문장 50회 반복 · 화자 12명)의
 * 재발 시험이다. **소스를 그대로 불러서** 확인한다 — 규칙을 여기 다시 적으면
 * 코드가 되돌아가도 시험은 통과해 버린다.
 *
 * v2 는 전사하는 곳이 **worker 와 backend 양쪽에** 있다. 둘 다 본다.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const dir = join('node_modules', '.sep-test');
mkdirSync(dir, { recursive: true });

// 통째로 번들한다 — backend 는 axios·winston 을 쓰는데 그 패키지가 worker 쪽
// node_modules 에 없다. external 로 두면 불러올 때 못 찾는다.
const bundle = async (entry, name) => {
  const out = join(process.cwd(), dir, name);
  await build({ entryPoints: [entry], bundle: true, format: 'esm',
                platform: 'node', outfile: out, logLevel: 'silent',
                // esm 번들 안에서 require 를 쓰는 CJS 의존이 있다 — 다리를 놔 준다
                banner: { js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);" } });
  return import(out);
};
const { collapseRepeats } = await bundle('src/services/openai.ts', 'openai.mjs');

const fails = [];
const check = (n, c, d = '') => { console.log(`${c ? '  OK  ' : '  FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!c) fails.push(n) };
const seg = (speaker, text, i) => ({ speaker, text, start_ms: i * 1000, end_ms: i * 1000 + 900 });

/** 같은 규칙을 worker·backend 두 구현에 똑같이 건다. */
function behaves(label, collapse) {
  console.log(`\n${label} — 반복 루프 (신고된 실제 문장)`);
  {
    const loop = Array.from({ length: 50 }, (_, i) => seg('A', 'So I explained.', i));
    const r = collapse(loop);
    check(`${label}: 50회 반복이 접힌다`, r.segments.length < 50, `50 → ${r.segments.length}줄`);
    check(`${label}: 접었다고 보고한다`, r.dropped > 40, `dropped=${r.dropped}`);
    check(`${label}: 몇 번이었는지 적힌다`, r.segments.at(-1).repeated === 50, `repeated=${r.segments.at(-1).repeated}`);
    check(`${label}: 시각은 끝까지 이어진다`, r.segments.at(-1).end_ms === loop.at(-1).end_ms);
  }
  console.log(`${label} — 버리지 않고 접는다`);
  {
    const r = collapse([seg('A', '네.', 0), seg('A', '네.', 1), seg('A', '네.', 2)]);
    check(`${label}: 짧은 맞장구 3번은 그대로`, r.segments.length === 3 && r.dropped === 0);
  }
  {
    const r = collapse([seg('A', '안녕하세요.', 0), seg('B', '안녕하세요.', 1), seg('A', '안녕하세요.', 2)]);
    check(`${label}: 화자가 다르면 접지 않는다`, r.segments.length === 3);
  }
  {
    const real = [seg('A', '가격이 어떻게 되나요?', 0), seg('B', '월 3만원입니다.', 1), seg('A', '할인은요?', 2)];
    const r = collapse(real);
    check(`${label}: 정상 대화는 한 글자도 안 건드린다`,
      JSON.stringify(r.segments) === JSON.stringify(real) && r.dropped === 0);
  }
  console.log(`${label} — 한 줄 안의 반복 (whisper 폴백 모양)`);
  {
    const loop = 'But then, today we cannot start. '.repeat(30).trim();
    const r = collapse([seg('A', loop, 0)]);
    const got = r.segments[0].text;
    check(`${label}: 한 덩이 안의 반복도 접힌다`, got.length < loop.length / 4, `${loop.length} → ${got.length}자`);
    check(`${label}: 첫 문장은 남는다`, got.startsWith('But then, today we cannot start.'));
  }
  {
    const r = collapse([seg('A', '이것은 서로 다른 문장입니다. 두 번째 문장입니다. 세 번째입니다.', 0)]);
    check(`${label}: 다른 문장은 안 접는다`, r.segments[0].text.includes('세 번째입니다'));
  }
}

behaves('worker', collapseRepeats);

// backend 는 SEP 시절의 사내 백엔드다. 같은 알고리즘을 각자 갖고 있어서
// **각자 확인해야 했다** — 한쪽만 고쳐 두면 그 경로로 들어온 녹취만 조용히 오염된다.
//
// **LEP 에서는 그 경로가 죽어 있다** (2026-08-26 베타 점검에서 확인).
// 의존성이 설치돼 있지 않고, CI·문서·worker 어디서도 부르지 않는다.
// 그래서 번들하려 하면 `axios` 를 못 찾고 시험 전체가 크래시했다 —
// **LEP 에서 이 시험은 한 번도 돈 적이 없었다.**
//
// 죽었다고 그냥 건너뛰지는 않는다. 건너뛰면 나중에 누가 되살렸을 때 아무도 모른다.
// **살아났는지를 시험이 직접 본다** — 살아나면 다시 실패하고, 그때 위 규칙을 다시 건다.
const BACKEND = join('..', 'backend', 'src', 'services', 'openaiService.ts');
const backendAlive = existsSync(join('..', 'backend', 'node_modules'))
  || (() => { try { return execSync('grep -rl "backend" ../worker/src ../.github 2>/dev/null').toString().trim() !== '' }
              catch { return false } })();

if (!existsSync(BACKEND)) {
  console.log('\nbackend — 소스가 없다. LEP 에서 지워진 것으로 본다.');
} else if (!backendAlive) {
  console.log('\nbackend — **죽은 코드다** (의존성 미설치 · 아무 데서도 안 부름).');
  console.log('  · 배포 대상이 아니므로 규칙을 걸지 않는다.');
  console.log('  · 되살리면 (의존성 설치 또는 worker/CI 에서 참조) 이 시험이 다시 막는다.');
} else {
  const mod = await bundle(BACKEND, 'backend-openai.mjs');
  const Svc = mod.OpenAIService ?? mod.default;
  behaves('backend', (segs) => Svc.collapseRepeats(segs));
}

console.log('\n언어 고정 — 전사하는 곳을 빠짐없이 센다');
{
  // 2026-08-20 첫 수정에서 risk.ts 를 빠뜨렸다. 한 곳이라도 남으면 그 경로의 녹취만
  // 조용히 영어로 나온다 — 그래서 파일을 세지 않고 **호출을 센다**.
  // 죽은 backend 는 세지 않는다 — 배포되지 않는 코드의 기본값은 아무것도 바꾸지 않는다
  const roots = ['src', ...(backendAlive ? [join('..', 'backend', 'src')] : [])].filter((d) => existsSync(d));
  let calls = 0, pinned = 0;
  const missing = [];
  for (const root of roots) {
    const files = execSync(`grep -rl "audio/transcriptions" ${root} --include=*.ts || true`,
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      const c = (t.match(/audio\/transcriptions/g) || []).length;
      const p = (t.match(/append\('language'/g) || []).length;
      calls += c; pinned += p;
      if (p < c) missing.push(`${f} (${p}/${c})`);
    }
  }
  check('언어를 안 거는 전사 경로가 없다', missing.length === 0 && calls > 0,
    `전사 호출 ${calls}곳 · 언어 고정 ${pinned}곳${missing.length ? ' — 빠진 곳: ' + missing.join(', ') : ''}`);

  const w = readFileSync('src/services/openai.ts', 'utf8');
  check('worker 기본값이 한국어다', /const STT_LANGUAGE = 'ko'/.test(w));
  check('worker 환경변수로 바꿀 수 있다', /env\.OPENAI_STT_LANGUAGE \|\| STT_LANGUAGE/.test(w));
  check('worker Env 타입에 선언돼 있다', /OPENAI_STT_LANGUAGE\?: string/.test(readFileSync('src/lib/env.ts', 'utf8')));
  if (backendAlive && existsSync(BACKEND)) {
    const b = readFileSync(BACKEND, 'utf8');
    check('backend 기본값이 한국어다', /OPENAI_STT_LANGUAGE = process\.env\.OPENAI_STT_LANGUAGE \|\| 'ko'/.test(b));
  }
}

console.log(fails.length ? `\n실패 ${fails.length}건: ${fails.join(', ')}` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
