#!/usr/bin/env node
/**
 * 오프사이트 백업 도구가 **거짓말을 하지 않는지** 본다.
 *
 * 이 도구의 유일한 가치는 「사본이 있다」 는 말이 참이라는 것이다.
 * 그러니 시험해야 할 것은 「돌았다」 가 아니라 **틀렸을 때 틀렸다고 말하는가**다.
 *
 * 실제 B2 에 붙지 않는다 — 자격증명 없이 돌아야 CI 에서 매번 돈다.
 * 붙는 것은 실제 실행이 확인한다.
 */
import { spawnSync } from 'node:child_process'
import { sign } from './r2-s3.js'

let fail = 0
const ok = (c, m, d = '') => {
  console.log(`  ${c ? '✓' : '✘'} ${m}${d ? ` — ${d}` : ''}`)
  if (!c) fail++
}

/** 도구를 주어진 환경으로 돌리고 출력과 종료코드를 본다. */
function run(env) {
  const r = spawnSync(process.execPath, [new URL('./offsite-backup.js', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000,
  })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

const FULL = {
  CF_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  R2_ACCESS_KEY_ID: 'rk', R2_SECRET_ACCESS_KEY: 'rs',
  OFFSITE_ENDPOINT: 's3.us-west-004.backblazeb2.com',
  OFFSITE_REGION: 'us-west-004',
  OFFSITE_ACCESS_KEY_ID: 'bk', OFFSITE_SECRET_ACCESS_KEY: 'bs',
}

console.log('── 설정이 없을 때 ──')
{
  const r = run({})
  ok(r.code === 0, '아무것도 없으면 **실패가 아니다** (아직 안 만든 것이지 고장난 것이 아니다)', `종료 ${r.code}`)
  ok(/미설정/.test(r.out), '  미설정이라고 적는다')
  ok(/계정 밖 사본이 없습니다/.test(r.out), '  무엇이 없는 상태인지 말한다')
  for (const n of Object.keys(FULL)) {
    if (n === 'OFFSITE_REGION') continue   // 기본값이 있다
    ok(r.out.includes(n), `  ${n} 이 없다고 이름으로 말한다`)
  }
}
{
  // **하나만 빠졌을 때 그 하나를 짚어야 한다.** 뭉뚱그리면 짐작으로 왕복하게 된다.
  const { OFFSITE_SECRET_ACCESS_KEY, ...part } = FULL
  const r = run(part)
  ok(r.code === 0 && /OFFSITE_SECRET_ACCESS_KEY/.test(r.out), '하나만 빠지면 그 하나를 짚는다')
  ok(!/CF_ACCOUNT_ID/.test(r.out), '  있는 것은 말하지 않는다')
}
{
  const r = run({ ...FULL, OFFSITE_SECRET_ACCESS_KEY: '   ' })
  ok(r.code === 0 && /OFFSITE_SECRET_ACCESS_KEY/.test(r.out),
     '공백만 들어 있는 것도 없는 것으로 본다 (붙여넣기 사고)')
}

console.log('\n── 목적지가 원본과 같으면 ──')
{
  const r = run({ ...FULL,
    OFFSITE_ENDPOINT: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com' })
  ok(r.code === 1, '**실패로 끝난다** — 계정 밖 사본이 아닌데 도는 것이 제일 나쁘다', `종료 ${r.code}`)
  ok(/같은 계정/.test(r.out), '  이유를 말한다')
}
{
  // 다른 계정의 R2 라면 통과해야 한다 — 회사를 바꾸는 것이 권장일 뿐 강제는 아니다
  const r = run({ ...FULL,
    OFFSITE_ENDPOINT: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.r2.cloudflarestorage.com' })
  ok(r.code !== 1 || !/같은 계정/.test(r.out), '다른 계정의 R2 는 막지 않는다')
}

console.log('\n── 로그에 자격증명이 새지 않는가 ──')
{
  // **도구를 돌려서는 이걸 못 본다.** `r2-s3.js` 가 계정 ID 를 6자로 잘라 찍으므로
  // 가리는 코드를 통째로 지워도 출력이 똑같다 — 그런 시험은 통과만 한다.
  // 그래서 가리는 함수를 직접 부른다.
  const r = run({ ...FULL, CF_ACCOUNT_ID: 'SECRETACCOUNTID0000000000000000x' })
  ok(!r.out.includes('SECRETACCOUNTID0'), '실행 출력에 계정 ID 전체가 안 나온다')

  process.env.CF_ACCOUNT_ID = 'SECRETACCOUNTID0000000000000000x'
  process.env.R2_ACCESS_KEY_ID = 'RKEY_SHOULD_NOT_APPEAR'
  process.env.OFFSITE_ACCESS_KEY_ID = 'BKEY_SHOULD_NOT_APPEAR'
  const { redact } = await import('./offsite-backup.js')
  const line = 'https://SECRETACCOUNTID0000000000000000x.r2.cloudflarestorage.com'
             + ' key=RKEY_SHOULD_NOT_APPEAR dst=BKEY_SHOULD_NOT_APPEAR'
             + ' /accounts/abcdef0123456789/r2'
  const got = redact(line)
  ok(!got.includes('SECRETACCOUNTID'), '가리는 함수가 계정 ID 를 지운다', got.slice(0, 60))
  ok(!got.includes('RKEY_SHOULD_NOT_APPEAR'), '  원본 접근키를 지운다')
  ok(!got.includes('BKEY_SHOULD_NOT_APPEAR'), '  목적지 접근키를 지운다')
  ok(!got.includes('abcdef0123456789'), '  주소 안의 계정 경로도 지운다')
}

console.log('\n── 주소를 긁어 붙였을 때 ──')
{
  const { host } = await import('./offsite-backup.js')
  const want = 's3.us-west-004.backblazeb2.com'
  for (const [given, why] of [
    ['s3.us-west-004.backblazeb2.com', '그대로 적은 것'],
    ['https://s3.us-west-004.backblazeb2.com', '브라우저에서 긁어 https:// 가 붙은 것'],
    ['https://s3.us-west-004.backblazeb2.com/', '끝에 / 까지 따라온 것'],
    ['  s3.us-west-004.backblazeb2.com  ', '앞뒤 공백'],
    ['HTTPS://s3.us-west-004.backblazeb2.com//', '대문자 · 슬래시 둘'],
  ]) {
    ok(host(given) === want, `${why} → 같은 주소가 된다`, host(given))
  }
}

console.log('\n── 리전을 주소에서 읽는가 ──')
{
  const { regionOf } = await import('./offsite-backup.js')
  for (const [h, want, why] of [
    ['s3.us-west-004.backblazeb2.com', 'us-west-004', 'B2'],
    ['s3.eu-central-003.backblazeb2.com', 'eu-central-003', 'B2 유럽'],
    ['s3.us-east-1.amazonaws.com', 'us-east-1', 'AWS 리전형'],
    ['s3.amazonaws.com', '', 'AWS 리전 없는 주소 — **amazonaws 를 집으면 안 된다**'],
    ['minio.example.com', '', '엉뚱한 주소'],
    ['', '', '빈 값'],
  ]) {
    ok(regionOf(h) === want, `${why} → «${want || '(못 읽음)'}»`, `받은 값 «${regionOf(h)}»`)
  }
}

console.log('\n── B2 서명이 R2 서명과 실제로 다른가 ──')
{
  const base = { accountId: 'acct', accessKeyId: 'AK', secretAccessKey: 'SK', method: 'GET', bucket: 'b' }
  const r2 = sign(base)
  const b2 = sign({ ...base, host: 's3.us-west-004.backblazeb2.com', region: 'us-west-004' })
  ok(b2.url.startsWith('https://s3.us-west-004.backblazeb2.com/'), '목적지 주소가 B2 다', b2.url)
  ok(/\/us-west-004\/s3\/aws4_request/.test(b2.headers.Authorization),
     '서명 범위에 B2 리전이 들어간다 — **여기가 틀리면 403 만 보고 원인을 못 찾는다**')
  ok(r2.headers.Authorization !== b2.headers.Authorization, '두 서명이 다르다')
  ok(/\/auto\/s3\/aws4_request/.test(r2.headers.Authorization), 'R2 는 그대로 auto 다 (기존 백업이 안 깨진다)')
}

console.log(fail ? `\n✘ ${fail}건 실패` : '\n✓ 오프사이트 백업 통과 — 없으면 없다고, 같으면 같다고 말한다')
process.exit(fail ? 1 : 0)
