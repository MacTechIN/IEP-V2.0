// 분할 경계 검증 — 브라우저 없이 순수 로직만 확인한다.
// v1 에서 같은 종류의 테스트가 "마지막 조각이 상한을 넘는" 실제 결함을 잡았다.
const TARGET_RATE = 16000, CHUNK_SEC = 600, MAX_CHUNK_SEC = 720;
const CUT_SEARCH_SEC = 30, CUT_WINDOW_SEC = 0.5;

function quietestPoint(data, from, to) {
  const win = Math.floor(CUT_WINDOW_SEC * TARGET_RATE);
  const start = Math.max(0, from), end = Math.min(data.length - win, to);
  if (end <= start) return Math.min(Math.max(from, 0), data.length);
  let best = start, bestEnergy = Infinity, energy = 0;
  for (let i = start; i < start + win; i++) energy += data[i] * data[i];
  for (let i = start; i < end; i++) {
    if (energy < bestEnergy) { bestEnergy = energy; best = i; }
    energy += data[i + win] * data[i + win] - data[i] * data[i];
  }
  return best + Math.floor(win / 2);
}

function plan(totalSec, quietAtSec = []) {
  const mono = new Float32Array(Math.round(totalSec * TARGET_RATE)).fill(0.5);
  for (const q of quietAtSec) {
    const c = Math.round(q * TARGET_RATE);
    for (let i = c - TARGET_RATE; i < c + TARGET_RATE && i < mono.length; i++) if (i >= 0) mono[i] = 0;
  }
  const target = CHUNK_SEC * TARGET_RATE, max = MAX_CHUNK_SEC * TARGET_RATE, search = CUT_SEARCH_SEC * TARGET_RATE;
  const cuts = [0];
  let guard = 0;
  while (mono.length - cuts[cuts.length - 1] > max) {
    if (++guard > 10000) throw new Error('무한 루프');
    const last = cuts[cuts.length - 1], remaining = mono.length - last;
    const nominal = remaining <= max * 2 ? last + Math.floor(remaining / 2) : last + target;
    const cut = quietestPoint(mono, nominal - search, nominal + search);
    if (cut <= last) break;
    cuts.push(cut);
  }
  cuts.push(mono.length);
  return cuts.slice(0, -1).map((c, i) => (cuts[i + 1] - c) / TARGET_RATE);
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${detail}`); }
};

for (const mins of [17, 21, 25, 33, 40, 61, 95]) {
  const parts = plan(mins * 60);
  const over = parts.filter((p) => p > MAX_CHUNK_SEC);
  const sum = parts.reduce((a, b) => a + b, 0);
  check(`${mins}분 → ${parts.length}조각, 최대 ${Math.round(Math.max(...parts))}초`,
        over.length === 0 && Math.abs(sum - mins * 60) < 1,
        over.length ? `상한 초과 ${over.map((p) => Math.round(p))}` : `합계 ${Math.round(sum)}초`);
}
// 무음이 있으면 그쪽으로 컷이 당겨지는가
const withQuiet = plan(25 * 60, [590]);
check('무음 지점(590초)으로 컷이 이동', Math.abs(withQuiet[0] - 590) < 2, `실제 ${Math.round(withQuiet[0])}초`);

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
