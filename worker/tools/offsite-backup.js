#!/usr/bin/env node
/**
 * 세 번째 사본 — **다른 회사**에. 지우는 코드는 이 파일에 없다.
 *
 * 계획서 4단계: docs/2026-08-13-r2-backup-plan.md
 *
 * ## 무엇이 다른가
 *
 * 같은 계정 안의 백업 버킷은 **계정 안의 사고**를 막는다 — 우리 코드가 지우거나,
 * 덮어쓰거나, 사람이 콘솔에서 지우는 것. 버킷 잠금까지 걸면 거기까지는 꽤 단단하다.
 * 막지 못하는 것은 **계정 자체를 잃는 경우**다: 정지, 결제 실패, 관리자 자격증명 유출.
 * 그때는 원본도 백업도 같이 사라진다.
 *
 * ## 왜 두 번째 Cloudflare 계정이 아닌가 (2026-08-27 결정)
 *
 * 08-13 계획서는 「2계정」 이라고 적었는데, **같은 회사의 두 계정은 같은 사람·같은
 * 결제수단에 매여 있다.** 정지나 결제 사고는 대개 계정이 아니라 그 사람에게 온다 —
 * 그러면 둘 다 같이 막힌다. 오프사이트가 막으려던 바로 그 경우다.
 * 그래서 **회사를 바꾼다.** 기본값은 Backblaze B2 다.
 *
 * ## 왜 백업 버킷이 아니라 **원본**에서 읽나
 *
 * 사본의 사본이면 백업 쪽이 잘못됐을 때 그 잘못을 그대로 물려받는다.
 * 원본에서 따로 읽으면 두 사본이 서로를 검증한다.
 * 이름은 백업과 같은 규칙(`<원래키>/<uploaded>`)이라 셋을 나란히 비교할 수 있다.
 *
 * ## 자격증명이 갈라져 있다 — 그것이 이 단계의 존재 이유다
 *
 * 읽기는 R2 키, 쓰기는 B2 키. **한쪽이 새도 다른 쪽 사본은 남는다.**
 * B2 키는 그 버킷 하나로만 범위를 잡는다.
 *
 * ## S3 API 로 부른다 (2026-08-27)
 *
 * 예전 판은 Cloudflare `client/v4` 를 썼다. 그건 **계정 단위 권한**을 요구해서
 * 넓은 토큰이 필요했고(`r2-s3.js` 의 사고 기록 참고), B2 에는 아예 없는 API 다.
 * 양쪽 다 S3 호환이므로 한 방식으로 통일한다 — 목적지를 바꾸는 것이 **설정 한 줄**이 된다.
 *
 * ## 실행
 *
 *   CF_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY   원본 읽기 (R2)
 *   OFFSITE_ENDPOINT · OFFSITE_REGION                          목적지 주소
 *   OFFSITE_ACCESS_KEY_ID · OFFSITE_SECRET_ACCESS_KEY          목적지 쓰기
 *   OFFSITE_BUCKET (기본 iep-uploads-offsite)
 *
 * 예 (B2 미국서부): OFFSITE_ENDPOINT=s3.us-west-004.backblazeb2.com
 *                   OFFSITE_REGION=us-west-004
 */
import { listObjects, getObject, putObject } from './r2-s3.js'

const SRC_BUCKET = process.env.R2_BUCKET || 'iep-uploads'
const DST_BUCKET = process.env.OFFSITE_BUCKET || 'iep-uploads-offsite'

const t = (v) => (v ?? '').trim()

const src = {
  accountId: t(process.env.CF_ACCOUNT_ID),
  accessKeyId: t(process.env.R2_ACCESS_KEY_ID),
  secretAccessKey: t(process.env.R2_SECRET_ACCESS_KEY),
}
/**
 * 주소에서 **사람이 딸려 붙이는 것**을 떼어 낸다.
 *
 * B2 화면은 `s3.us-west-004.backblazeb2.com` 로 보여 주는데, 브라우저에서 긁으면
 * `https://` 가 붙거나 끝에 `/` 가 따라온다. 그대로 두면 서명하는 호스트가 달라져
 * **403 만 보고 원인을 못 찾는다** — 값은 맞는데 안 되는 것처럼 보인다.
 * 여기서 떼는 것이 안내문으로 「붙이지 마세요」 라고 적는 것보다 확실하다.
 */
export const host = (v) => t(v).replace(/^https?:\/\//i, '').replace(/\/+$/, '')

/**
 * 주소에서 리전을 읽어 낸다. `s3.us-west-004.backblazeb2.com` → `us-west-004`
 *
 * **두 값을 따로 받으면 언젠가 서로 어긋난다.** 어긋나면 B2 는 `SignatureDoesNotMatch`
 * 만 돌려주는데, 그 말은 **키가 틀렸다는 뜻처럼 읽힌다** — 엉뚱한 데를 파게 된다.
 * 2026-08-27 첫 실행이 정확히 그렇게 실패했다.
 *
 * 그래서 **주소를 정본으로 삼는다.** `OFFSITE_REGION` 은 주소에서 못 읽을 때의 대비다
 * (`s3.amazonaws.com` 처럼 리전이 안 들어간 주소도 있다).
 * 리전처럼 생긴 것만 받는다 — `s3.amazonaws.com` 에서 `amazonaws` 를 집으면 안 된다.
 */
export const regionOf = (h) => (/^s3[.-]([a-z]{2}-[a-z]+-\d+)\./i.exec(h || '') || ['', ''])[1]

const dstHost = host(process.env.OFFSITE_ENDPOINT)
const dstRegionGiven = t(process.env.OFFSITE_REGION)
const dstRegionFromHost = regionOf(dstHost)

const dst = {
  host: dstHost,
  region: dstRegionFromHost || dstRegionGiven || 'us-west-004',
  accessKeyId: t(process.env.OFFSITE_ACCESS_KEY_ID),
  secretAccessKey: t(process.env.OFFSITE_SECRET_ACCESS_KEY),
  // S3 서명에는 accountId 가 안 쓰인다(host 를 직접 주므로). 자리만 채운다.
  accountId: 'offsite',
}

/**
 * 한 번에 올리는 한도.
 *
 * S3 `PutObject` 는 5GB 까지 되지만 **메모리에 통째로 올려놓고 보낸다.**
 * Actions 러너에서 그만큼을 잡으면 다른 것이 죽는다. 넘는 것은 **조용히 건너뛰지 않고**
 * 실패로 보고한다 — 조용히 빠지면 「전부 사본이 있다」 는 말이 거짓이 된다.
 */
const MAX_PUT = 500 * 1024 * 1024

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`
/** 백업과 **같은 규칙**이어야 한다. 어긋나면 셋을 나란히 못 본다. */
const backupKey = (o) => `${o.key}/${o.uploaded}`

/**
 * 이 출력은 **저장소에 커밋되는 로그**로 간다. 계정 ID 와 키를 지운다.
 *
 * 내보내는 이유는 시험 때문이다. 도구를 통째로 돌려서는 이걸 시험할 수 없다 —
 * `r2-s3.js` 가 계정 ID 를 이미 6자로 잘라 찍어서, 여기를 아예 없애도
 * 출력만 봐서는 아무 차이가 안 난다(2026-08-27에 그런 시험을 쓰다 발견했다).
 * **실패할 수 없는 시험은 없느니만 못하다.**
 */
export const redact = (s) => {
  let out = String(s)
  for (const v of [src.accountId, src.accessKeyId, dst.accessKeyId]) {
    if (v && v.length > 3) out = out.replaceAll(v, '***')
  }
  return out.replace(/\/accounts\/[^/\s]+/g, '/accounts/***')
}

/** 무엇이 없는지 **이름으로** 말한다. 값은 절대 찍지 않는다. */
export function missing() {
  const need = {
    CF_ACCOUNT_ID: src.accountId,
    R2_ACCESS_KEY_ID: src.accessKeyId,
    R2_SECRET_ACCESS_KEY: src.secretAccessKey,
    OFFSITE_ENDPOINT: dst.host,
    OFFSITE_ACCESS_KEY_ID: dst.accessKeyId,
    OFFSITE_SECRET_ACCESS_KEY: dst.secretAccessKey,
  }
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k)
}

/**
 * 값의 **생김새**만 적는다. 값은 절대 찍지 않는다.
 *
 * 길이만으로는 「25자·31자」 로 B2 형식과 같아 보이는데도 401 이 났다 (2026-08-27).
 * 그러면 다음에 볼 것은 **글자의 종류**다:
 *   B2 keyID          16진수 25자
 *   B2 applicationKey `K` + 숫자로 시작하는 영숫자 31자
 * 여기서 어긋나면 무엇을 잘못 복사했는지가 바로 드러난다 —
 * keyName 을 넣었거나, 두 값을 바꿔 넣었거나, 안 보이는 글자가 딸려 왔거나.
 */
function shape(v) {
  const n = v.length
  const hex = /^[0-9a-f]+$/.test(v)
  const kv = /^K\d/.test(v)
  const alnum = /^[0-9A-Za-z]+$/.test(v)
  const odd = [...v].filter((c) => !/[0-9A-Za-z]/.test(c))
  const bits = []
  if (hex) bits.push('16진수')
  else if (kv) bits.push('K+숫자로 시작')
  else if (alnum) bits.push('영숫자')
  else bits.push(`**영숫자가 아닌 글자 ${odd.length}개**`)
  return `${n}자 (${bits.join(' · ')})`
}

/**
 * **B2 에게 직접 물어본다.** 키가 틀린 것인지 주소가 틀린 것인지 가른다.
 *
 * S3 API 는 둘 다 `SignatureDoesNotMatch` 로만 답한다 — 그 말은 키가 틀렸다는 뜻처럼
 * 읽혀서, 주소가 문제일 때 엉뚱한 데를 파게 된다 (2026-08-27 에 두 번 그랬다).
 *
 * B2 의 고유 API `b2_authorize_account` 는 keyID·applicationKey 로 인증하고
 * **그 계정의 올바른 S3 주소를 알려 준다.** 그래서 한 번에 둘 다 판가름난다:
 *
 *   401 이 오면            → 키가 틀렸다 (주소는 볼 것도 없다)
 *   200 인데 주소가 다르면 → 키는 맞고 **주소를 잘못 넣은 것이다**
 *
 * 실패했을 때만 부른다. 잘 돌 때는 부르지 않는다.
 */
async function askB2(keyId, appKey) {
  try {
    const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${appKey}`).toString('base64')}` },
    })
    if (res.status === 401) return { ok: false, why: '키를 B2 가 받지 않습니다 (401)' }
    if (!res.ok) return { ok: false, why: `B2 확인 실패 (HTTP ${res.status})` }
    const d = await res.json()
    const url = d?.apiInfo?.storageApi?.s3ApiUrl || d?.s3ApiUrl || ''
    const buckets = d?.apiInfo?.storageApi?.bucketName ?? d?.allowed?.bucketName ?? null
    return { ok: true, s3: host(url), bucket: buckets }
  } catch (e) {
    return { ok: false, why: `B2 에 못 붙었습니다 — ${String(e.message).slice(0, 80)}` }
  }
}

async function main() {
  const gone = missing()
  if (gone.length) {
    /**
     * **아직 안 만든 것**이지 고장난 것이 아니다. 눈에 띄게 적고 `0` 으로 나간다.
     *
     * 2026-08-26 실측: 백업 자체는 OK 였는데 이 줄이 `2` 를 내는 바람에 워크플로가
     * 전체를 실패로 기록했다(`max(A,B)`). 잘 도는 백업을 이것 때문에 빨갛게 만들면
     * 진짜 사고 때 아무도 안 본다.
     */
    console.log(`오프사이트: 미설정 — **계정 밖 사본이 없습니다** (${gone.join(' · ')})`)
    process.exit(0)
  }
  if (dst.host.includes('r2.cloudflarestorage.com') && dst.host.startsWith(src.accountId)) {
    // 같은 계정이면 이 단계는 아무것도 막지 못한다. **조용히 도는 것이 제일 나쁘다.**
    console.log('오프사이트: 실패 — 목적지가 원본과 같은 계정입니다. 계정 밖 사본이 아닙니다')
    process.exit(1)
  }

  // **주소와 리전이 어긋나면 그것부터 말한다.** 어긋난 채로 보내면 B2 는
  // `SignatureDoesNotMatch` 만 돌려주는데, 그 말은 키가 틀렸다는 뜻처럼 읽힌다.
  if (dstRegionFromHost && dstRegionGiven && dstRegionFromHost !== dstRegionGiven) {
    console.log(`오프사이트: 주의 — OFFSITE_REGION 이 «${dstRegionGiven}» 인데 `
      + `주소는 «${dstRegionFromHost}» 입니다. **주소를 따릅니다** — `
      + 'OFFSITE_REGION 을 고치거나 지우십시오')
  }

  /**
   * 목적지 주소 표기를 **재서 정한다.**
   *
   * S3 구현마다 받아 주는 것이 다르다 — 경로형(`호스트/버킷/키`)과
   * 주소형(`버킷.호스트/키`). 틀리면 `SignatureDoesNotMatch` 만 돌아오고
   * 그 말은 키가 틀렸다는 뜻처럼 읽힌다. **추측하지 말고 한 번씩 보내 본다.**
   * 통한 쪽을 로그에 적는다 — 다음 사람이 같은 데를 파지 않게.
   */
  let from, to, styleNote = ''
  try {
    from = await listObjects(src, SRC_BUCKET)
    try {
      to = await listObjects(dst, DST_BUCKET)
      styleNote = '경로형'
    } catch (e1) {
      if (!/SignatureDoesNotMatch|AccessDenied|InvalidAccessKeyId|Unauthorized|NoSuchBucket/i.test(String(e1.message))) throw e1
      console.log(`오프사이트: 경로형이 거절됨 (${redact(String(e1.message)).slice(0, 90)}) — 주소형으로 다시 봅니다`)
      dst.virtualHost = true
      to = await listObjects(dst, DST_BUCKET)
      styleNote = '주소형 (경로형은 거절됨)'
    }
  } catch (e) {
    // **여기서 죽으면 무엇을 고쳐야 하는지 알 수 없다.** 값은 안 찍고 모양만 적는다 —
    // 길이가 이상하면 붙여넣기가 딸려 온 것이고, 리전이 다르면 그것이 원인이다.
    const m = String(e.message)
    console.log(`오프사이트: 실패 — ${redact(m)}`)
    if (/SignatureDoesNotMatch|AccessDenied|InvalidAccessKeyId|Unauthorized/i.test(m)) {
      console.log(`  주소   ${dst.host}`)
      console.log(`  리전   ${dst.region}`
        + (dstRegionFromHost ? ' (주소에서 읽음)' : ' (OFFSITE_REGION 값)'))
      console.log(`  버킷   ${DST_BUCKET}`)
      console.log(`  키ID   ${shape(dst.accessKeyId)} · 비밀키 ${shape(dst.secretAccessKey)}`)
      // **여기서 판가름낸다.** 위 정보만으로는 사람이 또 짐작해야 한다.
      const b2 = await askB2(dst.accessKeyId, dst.secretAccessKey)
      if (!b2.ok) {
        console.log(`  B2 확인 — ${b2.why}`)
        // **자리를 바꿔 넣었는지도 재 본다.** 물어보면 되는 것을 짐작하게 두지 않는다.
        const sw = await askB2(dst.secretAccessKey, dst.accessKeyId)
        if (sw.ok) {
          console.log('  → **두 값이 뒤바뀌었습니다.** OFFSITE_ACCESS_KEY_ID 에 applicationKey 를,'
            + ' OFFSITE_SECRET_ACCESS_KEY 에 keyID 를 넣으셨습니다. 서로 바꿔 등록하십시오')
        } else {
          console.log('  → 이 쌍을 B2 가 모릅니다. **키를 다시 발급**하고 그 화면에서 곧바로 옮기십시오')
          console.log('     keyID 는 16진수 25자, applicationKey 는 K 로 시작하는 31자입니다 —')
          console.log('     위 「생김새」 가 이와 다르면 다른 값을 복사하신 것입니다 (keyName 이 아닙니다)')
        }
      } else {
        console.log('  B2 확인 — 키는 유효합니다')
        if (b2.bucket) console.log(`  B2 가 이 키에 허용한 버킷: ${b2.bucket}`)
        if (b2.s3 && b2.s3 !== dst.host) {
          // 아래 주소는 **시크릿과 다르므로 가려지지 않는다** — 그래서 눈에 보인다.
          console.log(`  → **주소가 틀렸습니다.** B2 가 알려 준 올바른 주소: ${b2.s3}`)
          console.log(`     OFFSITE_ENDPOINT 를 이 값으로 바꾸고 OFFSITE_REGION 은 지우십시오`)
        } else if (b2.s3) {
          console.log('  → 주소도 맞습니다. 남은 것은 버킷 이름이나 키 권한입니다')
        }
      }
    }
    process.exit(1)
  }
  const have = new Map(to.map((o) => [o.key, o.size]))
  const todo = from.filter((o) => have.get(backupKey(o)) !== o.size)

  console.log(`오프사이트: 원본 ${from.length}개 ${mb(from.reduce((a, b) => a + b.size, 0))} · 사본 ${to.length}개`
    + (styleNote ? ` · ${styleNote}` : ''))

  let put = 0
  const failed = []
  for (const o of todo) {
    if (o.size > MAX_PUT) {
      failed.push(`${o.key} — ${mb(o.size)}, 한 번에 올리는 한도 ${mb(MAX_PUT)} 초과`)
      continue
    }
    try {
      const got = await getObject(src, SRC_BUCKET, o.key)
      // **읽은 바이트가 목록과 다르면 올리지 않는다.** 반쪽 사본이 「있다」 로 세어지면
      // 그것이 백업이 있다는 거짓말이 된다.
      if (got.body.length !== o.size) throw new Error(`크기 불일치 ${got.body.length} ≠ ${o.size}`)
      await putObject(dst, DST_BUCKET, backupKey(o), got.body,
                      got.contentType || 'application/octet-stream')
      have.set(backupKey(o), got.body.length)
      put++
    } catch (e) {
      failed.push(`${o.key} — ${redact(e.message)}`)
    }
  }

  // 원본마다 사본이 있고 크기가 같은가. **전부 본다** — 목록만으로 되니 공짜다.
  for (const o of from) {
    const n = have.get(backupKey(o))
    if (n === o.size) continue
    failed.push(n === undefined ? `${o.key} — 사본 없음` : `${o.key} — 크기 다름 ${n} ≠ ${o.size}`)
  }

  console.log(`오프사이트: 넣음 ${put}개 · 이미 있음 ${from.length - todo.length}개`)
  if (failed.length) {
    console.log(`오프사이트: 실패 ${failed.length}건`)
    for (const f of failed.slice(0, 10)) console.log(`  ${f}`)
    if (failed.length > 10) console.log(`  … 그 밖 ${failed.length - 10}건`)
    process.exit(1)
  }
  console.log(`오프사이트: OK — ${from.length}개가 ${dst.host} 에도 있고 크기가 같습니다`)
}

// **직접 실행할 때만 돈다.** 시험이 `redact` 를 불러다 쓰려면 import 만으로 돌면 안 된다.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => { console.log(`오프사이트: 실패 — ${redact(e.message)}`); process.exit(2) })
}
