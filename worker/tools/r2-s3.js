/**
 * R2 를 **S3 호환 API 로** 부른다 — 좁은 토큰(`Object Read & Write`)으로 돌기 위해서다.
 *
 * ## 왜 이 파일이 생겼나
 *
 * 2026-08-15 09:30Z 부터 백업이 28회 연속 실패했다. 원인은 사고가 아니라
 * **우리가 일부러 한 일**이었다. `2026-08-13-r2-backup-plan.md:147` 이
 *
 *   > 토큰을 `Object Read & Write` 로 낮춰야 한다. 백업 작업은 객체 읽기·쓰기만
 *   > 하므로 **낮춰도 그대로 돈다.**
 *
 * 라고 적었고 그날 낮췄는데, **마지막 문장이 틀렸다.** 백업 도구가 쓰던
 * `api.cloudflare.com/client/v4/.../r2/buckets/{b}/objects` 는 **계정 단위 권한**을
 * 요구한다. R2 의 `Object Read & Write` 토큰은 **S3 호환 API 용**이라 거기서는 403 이다.
 * 로그가 스스로 그렇게 진단하고 있었다 — "둘 다 안 읽히면 이 REST API 가 Object 범위
 * 토큰을 받지 않는 것입니다."
 *
 * 갈림길은 둘이었다.
 *
 *   A. 토큰을 `Admin Read & Write` 로 넓힌다 → 백업은 살아나지만
 *      **토큰이 새면 잠금을 풀고 백업까지 지울 수 있다.** 08-13 계획서가 없애려던 구멍이다
 *   B. 도구를 S3 API 로 옮긴다 → 토큰은 좁은 채로 둔다        ← **이쪽을 골랐다**
 *
 * ## 그래서 권한이 두 갈래로 갈린다 — 그것이 이 설계의 값이다
 *
 *   객체 (목록·읽기·쓰기·지우기)  S3 API      ← 좁은 토큰. **6시간마다 도는 것은 이것뿐이다**
 *   버킷 (목록·생성·잠금)         client/v4   ← 넓은 토큰. **사람이 손으로 켤 때만**
 *
 * 예약 실행은 이제 넓은 토큰이 아예 필요 없다. 잠금을 못 읽으면 "못 읽음" 이라고
 * 적고 넘어간다 — **그것이 오히려 바라는 상태다.** 이 토큰으로는 잠금을 풀 수도 없다는 뜻이다.
 *
 * ## 서명은 손으로 짠다
 *
 * `worker/package.json` 에 AWS SDK 가 없고, 백업 도구 하나 때문에 의존성을 늘리지
 * 않는다. SigV4 는 `node:crypto` 로 60줄이면 된다.
 *
 * **다만 서명이 맞는지는 R2 에 실제로 보내 봐야 안다.** 여기 `selfTest()` 는
 * 인코딩 규칙과 정규 요청의 모양만 본다 — 그것이 이 파일 혼자 확인할 수 있는 전부다.
 *
 * ## 자격증명
 *
 *   CF_ACCOUNT_ID          계정 ID
 *   R2_ACCESS_KEY_ID       R2 API 토큰 발급 화면에 함께 나온다
 *   R2_SECRET_ACCESS_KEY   같은 화면. **한 번만 보여 준다**
 */
import { createHash, createHmac } from 'node:crypto'

const REGION = 'auto'
const SERVICE = 's3'

/** 빈 본문의 SHA-256. GET·DELETE·목록에 쓴다. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()

/**
 * RFC3986. `encodeURIComponent` 는 `!'()*` 를 안 건드리는데 **S3 는 건드린다** —
 * 그 다섯 글자가 키에 들어 있으면 서명이 안 맞고, 원인이 눈에 안 띈다.
 */
const enc = (s) => encodeURIComponent(s)
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** 키의 `/` 는 경로 구분자다. 통째로 인코딩하면 경로가 깨진다. */
const encPath = (key) => key.split('/').map(enc).join('/')

/** `20260824T091500Z` · `20260824`. */
function stamps(now) {
  const t = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate: t, dateOnly: t.slice(0, 8) }
}

/**
 * 서명해서 `fetch` 에 넣을 것을 돌려준다.
 *
 * `payloadHash` 를 밖에서 받는 이유 — PUT 은 본문을 해시해야 하는데 그 본문이
 * 큰 버퍼다. 여기서 다시 해시하면 같은 바이트를 두 번 읽는다.
 */
export function sign({ accountId, accessKeyId, secretAccessKey, host: hostOverride, region = REGION, virtualHost = false, method, bucket, key = '', query = {}, headers = {}, payloadHash = EMPTY_SHA256, now = new Date() }) {
  // **주소를 밖에서 받을 수 있다** (2026-08-26). 계정 밖 사본을 R2 가 아닌 곳
  // (Backblaze B2·AWS S3 …)에 두려면 호스트가 달라진다. 안 주면 R2 그대로다.
  // `region` 도 같은 이유다 — R2 는 `auto` 지만 S3 는 버킷의 리전이어야 서명이 맞는다.
  // **버킷을 주소에 넣을 것인가 경로에 넣을 것인가.** S3 구현마다 받아 주는 것이 다르다 —
  // R2 는 경로형(`/버킷/키`)으로 잘 되는데, 어떤 곳은 주소형(`버킷.호스트/키`)만 받는다.
  // 서명은 이 차이를 그대로 반영해야 한다. 틀리면 `SignatureDoesNotMatch` 만 돌아오고,
  // 그 말은 **키가 틀렸다는 뜻처럼 읽힌다** (2026-08-27 B2 첫 연결).
  const base = hostOverride || `${accountId}.r2.cloudflarestorage.com`
  const host = virtualHost ? `${bucket}.${base}` : base
  const { amzDate, dateOnly } = stamps(now)

  const canonicalUri = virtualHost
    ? (key ? `/${encPath(key)}` : '/')
    : `/${enc(bucket)}${key ? `/${encPath(key)}` : ''}`
  const canonicalQuery = Object.keys(query).sort()
    .map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&')

  const all = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    // 밖에서 준 헤더도 **서명에 넣는다.** 서명 안 한 헤더를 보내면 R2 는 받아 주지만,
    // 서명한 헤더를 안 보내면 거절한다 — 넣는 쪽이 안전하다.
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])),
  }
  const names = Object.keys(all).sort()
  const canonicalHeaders = names.map((n) => `${n}:${all[n].trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n')

  const scope = `${dateOnly}/${region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest),
  ].join('\n')

  let k = hmac(`AWS4${secretAccessKey}`, dateOnly)
  for (const part of [region, SERVICE, 'aws4_request']) k = hmac(k, part)
  const signature = createHmac('sha256', k).update(stringToSign).digest('hex')

  return {
    url: `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
    headers: {
      ...all,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},`
        + ` SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,   // 진단용. **찍지 않는다** — 자격증명은 안 들어 있지만 키 이름이 들어 있다
  }
}

/**
 * 서명해서 보낸다.
 *
 * **못 붙은 것과 거절당한 것을 가른다.** R2 의 주소는 계정마다 다른 서브도메인이라
 * (`<계정ID>.r2.cloudflarestorage.com`) **계정 ID 가 틀리면 이름조차 안 풀린다.**
 * 그것을 `fetch failed` 로만 보고하면 서명이 틀린 줄 알고 엉뚱한 데를 파게 된다.
 */
export async function s3fetch(cred, opts) {
  const { url, headers } = sign({ ...cred, ...opts })
  try {
    return await fetch(url, { method: opts.method, headers, body: opts.body })
  } catch (e) {
    // 없는 계정 ID 는 **DNS 가 아니라 TLS 에서** 걸린다 — 와일드카드로 이름은 풀리는데
    // Cloudflare 가 그 SNI 를 거절한다 (2026-08-24 실제로 확인: ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE).
    // 둘 다 뜻은 같다: **주소를 만든 계정 ID 가 틀렸다.**
    const why = String(e?.cause?.code || e?.cause?.message || e.message)
    const badAccount = /ENOTFOUND|EAI_AGAIN|getaddrinfo|HANDSHAKE|SSL|TLS/i.test(why)
    throw new Error(badAccount
      ? `R2 에 못 붙었습니다 — **CF_ACCOUNT_ID 를 확인하세요** (${cred.accountId?.slice(0, 6)}… 로 주소를 만듭니다) [${why}]`
      : `R2 에 못 붙었습니다 — ${why}`)
  }
}

/**
 * XML 한 겹만 읽는다. **파서를 의존성으로 들이지 않는다** — ListObjectsV2 의
 * 응답은 모양이 고정이라 이걸로 충분하다.
 */
const tagAll = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])
const tagOne = (xml, tag) => tagAll(xml, tag)[0] ?? null
/** `&amp;` 등을 되돌린다. 키에 `&` 가 들어 있으면 이게 없으면 이름이 달라진다. */
const unxml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/**
 * 버킷의 객체 전부. **커서가 없어질 때까지 돈다** — 잘라 읽으면 이미 넣은 것을
 * 안 넣었다고 보고 매번 다시 올린다.
 *
 * `{ key, size, uploaded }` 로 돌려준다 — client/v4 가 주던 것과 **같은 모양**이라
 * 부르는 쪽 코드가 안 바뀐다.
 */
export async function listObjects(cred, bucket) {
  const out = []
  let token = ''
  for (;;) {
    const query = { 'list-type': '2', 'max-keys': '1000' }
    if (token) query['continuation-token'] = token
    const res = await s3fetch(cred, { method: 'GET', bucket, query })
    const body = await res.text()
    if (!res.ok) {
      // **`Message` 를 버리지 않는다.** `SignatureDoesNotMatch` 만으로는
      // 키가 틀린 것인지 리전이 틀린 것인지 알 수 없다 — S3 는 그 차이를 본문에 적어 준다.
      const code = tagOne(body, 'Code') || `HTTP ${res.status}`
      const msg = tagOne(body, 'Message')
      throw new Error(`${bucket} 조회 실패 (HTTP ${res.status}) ${code}`
        + (msg ? ` — ${unxml(msg).slice(0, 160)}` : ''))
    }
    for (const c of tagAll(body, 'Contents')) {
      out.push({
        key: unxml(tagOne(c, 'Key')),
        size: Number(tagOne(c, 'Size')),
        // **ISO 문자열로 못 박는다.** 백업 키가 이 값으로 만들어지므로,
        // API 마다 표기가 다르면 같은 파일이 다른 키가 되어 전부 다시 올라간다.
        uploaded: new Date(tagOne(c, 'LastModified')).toISOString(),
      })
    }
    if (tagOne(body, 'IsTruncated') !== 'true') return out
    token = unxml(tagOne(body, 'NextContinuationToken') || '')
    if (!token) return out
  }
}

/**
 * S3 가 왜 거절했는지 **버리지 않는다.**
 *
 * 2026-08-25 에 쓰기가 전부 403 이었는데 `쓰기 HTTP 403` 이라고만 찍고 있었다.
 * S3 는 실패할 때 XML 로 `<Code>` 를 준다 — `AccessDenied` 인지
 * `SignatureDoesNotMatch` 인지에 따라 **고치는 데가 완전히 다르다.**
 * 앞의 것은 권한이고 뒤의 것은 우리 서명 코드다.
 */
async function s3error(res, what) {
  const body = await res.text().catch(() => '')
  const code = tagOne(body, 'Code')
  const msg = tagOne(body, 'Message')
  return new Error(`${what} HTTP ${res.status}`
    + (code ? ` ${code}` : '')
    + (msg ? ` — ${unxml(msg).slice(0, 120)}` : (body ? ` — ${body.slice(0, 120)}` : '')))
}

export async function getObject(cred, bucket, key) {
  const res = await s3fetch(cred, { method: 'GET', bucket, key })
  if (!res.ok) throw await s3error(res, '읽기')
  return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') }
}

export async function putObject(cred, bucket, key, body, contentType) {
  const res = await s3fetch(cred, {
    method: 'PUT', bucket, key, body,
    headers: { 'content-type': contentType || 'application/octet-stream' },
    payloadHash: sha256(body),
  })
  if (!res.ok) throw await s3error(res, '쓰기')
  return res
}

export const deleteObject = (cred, bucket, key) =>
  s3fetch(cred, { method: 'DELETE', bucket, key })

export const headObject = (cred, bucket, key) =>
  s3fetch(cred, { method: 'HEAD', bucket, key })

/**
 * 환경에서 자격증명을 모은다. 없으면 `null` — 부르는 쪽이 '못봄' 으로 끝낸다.
 *
 * **붙여넣기 사고를 여기서 막는다.** 시크릿에 줄바꿈이나 앞뒤 공백이 딸려 들어가는
 * 일이 흔한데, 그러면 서명이 조용히 어긋나 `SignatureDoesNotMatch` 로만 나온다 —
 * 값이 틀린 것과 구분이 안 되는 가장 나쁜 실패다. 잘라서 쓴다.
 */
export function credFromEnv() {
  const t = (v) => (v ?? '').trim()
  const c = {
    accountId: t(process.env.CF_ACCOUNT_ID),
    accessKeyId: t(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: t(process.env.R2_SECRET_ACCESS_KEY),
  }
  return c.accountId && c.accessKeyId && c.secretAccessKey ? c : null
}

/**
 * **무엇이 없는지 이름으로 말한다.** 값은 절대 찍지 않는다.
 *
 * 2026-08-24 에 시크릿을 넣고 돌렸는데 '못봄' 이 나왔다. 그때 메시지가 셋을
 * 한 줄로 묶어 말해서 **어느 것이 없는지 알 수 없었다** — 짐작으로 왕복하게 된다.
 * 있는 것은 길이만 적는다. 길이가 0 이 아닌데 안 통하면 값이 틀린 것이고,
 * 길이가 이상하면(예: 32자여야 하는데 33자) 붙여넣기가 딸려 온 것이다.
 */
export function credReport() {
  const names = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
  return names.map((n) => {
    const raw = process.env[n]
    if (raw === undefined) return `  ${n}  **없음** — 이 이름으로 등록되지 않았습니다`
    const v = raw.trim()
    if (!v) return `  ${n}  **비어 있음** — 값 없이 등록된 것 같습니다`
    const trimmed = raw.length !== v.length ? ` (앞뒤 공백 ${raw.length - v.length}자를 잘라냈습니다)` : ''
    return `  ${n}  있음 · ${v.length}자${trimmed}`
  }).join('\n')
}

/**
 * 이 파일 혼자 확인할 수 있는 것만 본다.
 *
 * **서명이 R2 에 통하는지는 여기서 못 본다.** 보내 봐야 안다 — 그게
 * `node worker/tools/r2-backup.js` 를 한 번 돌리는 일이다.
 */
export function selfTest() {
  const fails = []
  const check = (n, c, d = '') => { console.log(`${c ? '  OK  ' : '  FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!c) fails.push(n) }

  check('빈 본문 해시가 알려진 값이다', sha256('') === EMPTY_SHA256, EMPTY_SHA256.slice(0, 16) + '…')

  // **키의 슬래시는 살아 있어야 한다.** 통째로 인코딩하면 경로가 깨진다.
  check('키의 / 는 경로로 남는다', encPath('a/b/c.m4a') === 'a/b/c.m4a')
  check('공백은 %20 이다 (+ 가 아니다)', encPath('a b.m4a') === 'a%20b.m4a', encPath('a b.m4a'))
  check("!'()* 도 인코딩한다", enc("a!'()*b") === 'a%21%27%28%29%2Ab', enc("a!'()*b"))
  const ko = encPath('녹음/1.m4a')
  check('한글 키가 인코딩된다', !/[가-힣]/.test(ko) && ko.includes('%'), ko)
  check('한글 키가 되돌아온다', decodeURIComponent(ko) === '녹음/1.m4a')

  const cred = { accountId: 'acct', accessKeyId: 'AKID', secretAccessKey: 'SECRET' }
  const now = new Date('2026-08-24T09:15:00.000Z')
  const s = sign({ ...cred, method: 'GET', bucket: 'b', key: 'k/1.m4a', now })
  const lines = s.canonicalRequest.split('\n')

  check('정규 요청이 6칸이다', lines.length >= 6, `${lines.length}줄`)
  check('메서드·경로가 맞다', lines[0] === 'GET' && lines[1] === '/b/k/1.m4a', lines[1])
  check('서명 헤더가 사전순이다', s.canonicalRequest.includes('host;x-amz-content-sha256;x-amz-date'))
  check('시각이 20260824T091500Z 다', s.headers['x-amz-date'] === '20260824T091500Z', s.headers['x-amz-date'])
  check('범위가 auto/s3 다', s.headers.Authorization.includes('/20260824/auto/s3/aws4_request'))
  check('서명이 64자 hex 다', /Signature=[0-9a-f]{64}$/.test(s.headers.Authorization))

  // **같은 입력이면 같은 서명이다.** 아니면 어딘가에 시각·난수가 새어 들어간 것이다.
  const again = sign({ ...cred, method: 'GET', bucket: 'b', key: 'k/1.m4a', now })
  check('같은 입력 → 같은 서명', again.headers.Authorization === s.headers.Authorization)
  // **다른 입력이면 다른 서명이다.** 아니면 서명이 입력을 안 보고 있다.
  const other = sign({ ...cred, method: 'GET', bucket: 'b', key: 'k/2.m4a', now })
  check('키가 다르면 서명도 다르다', other.headers.Authorization !== s.headers.Authorization)
  const put = sign({ ...cred, method: 'PUT', bucket: 'b', key: 'k/1.m4a', now })
  check('메서드가 다르면 서명도 다르다', put.headers.Authorization !== s.headers.Authorization)
  const key2 = sign({ ...cred, secretAccessKey: 'OTHER', method: 'GET', bucket: 'b', key: 'k/1.m4a', now })
  check('비밀키가 다르면 서명도 다르다', key2.headers.Authorization !== s.headers.Authorization)

  // 질의는 **사전순**이어야 한다. 순서가 흔들리면 서명이 안 맞는다.
  const q = sign({ ...cred, method: 'GET', bucket: 'b', query: { 'max-keys': '1000', 'list-type': '2' }, now })
  check('질의가 사전순으로 정렬된다', q.canonicalRequest.split('\n')[2] === 'list-type=2&max-keys=1000',
    q.canonicalRequest.split('\n')[2])

  // XML 읽기
  const xml = '<ListBucketResult><Contents><Key>a&amp;b/1.m4a</Key><Size>123</Size>'
    + '<LastModified>2026-08-14T11:00:00.000Z</LastModified></Contents>'
    + '<IsTruncated>false</IsTruncated></ListBucketResult>'
  check('XML 에서 키를 읽는다', unxml(tagOne(tagAll(xml, 'Contents')[0], 'Key')) === 'a&b/1.m4a')
  check('LastModified 를 ISO 로 못 박는다',
    new Date(tagOne(tagAll(xml, 'Contents')[0], 'LastModified')).toISOString() === '2026-08-14T11:00:00.000Z')

  console.log(fails.length ? `\n!! 실패 ${fails.length}건` : '\n전부 통과')
  console.log('\n**서명이 R2 에 통하는지는 여기서 못 본다.** 한 번 보내 봐야 안다:');
  console.log('  CF_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node worker/tools/r2-backup.js')
  return fails.length
}

if (process.argv[1]?.endsWith('r2-s3.js')) process.exit(selfTest() ? 1 : 0)
