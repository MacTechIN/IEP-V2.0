// OpenAI 호출 — 사내 백엔드 services/openaiService.ts 이관분 (C-5-2)
//
// 옮기면서 바꾼 것은 **전달 방식뿐이다.**
//   axios + form-data(Node 스트림) → 표준 fetch + FormData
//   fs.createReadStream(경로)      → R2 객체의 body
// **프롬프트·모델·temperature·파싱 규칙은 한 글자도 바꾸지 않았다.** 결과가 달라지면 안 된다.
//
// winston 은 console 로 간다 (Workers 표준 출력이 그대로 관측 대상이다).

import type { Env } from '../lib/env'
import { logLine } from '../lib/log'

const STT_DIARIZE = 'gpt-4o-transcribe-diarize'
const STT_PLAIN = 'whisper-1'

/**
 * 전사 언어. **보내지 않으면 모델이 요청마다 스스로 고른다.**
 *
 * 2026-08-20 에 그 때문에 한국어 회의의 일부 구간이 영어로 전사됐다. 이 제품이 다루는
 * 회의는 한국어에 영어 낱말이 잔뜩 섞여(`TFTA`·`AI`·`solution`…) **자동 판별이 영어로
 * 넘어가기 가장 쉬운 조건**이고, 한 번 넘어가면 그 구간 전체가 영어로 나온다.
 *
 * 환경변수로 두는 이유 — 영어가 주인 회의도 있을 수 있다. 기본값만 한국어다.
 */
const STT_LANGUAGE = 'ko'
const CHAT = 'gpt-4o-mini'

export interface DiarizedSegment {
  speaker: string; start_ms: number; end_ms: number; text: string
  /**
   * STT 가 이 파일 안에서 붙인 **원래 화자 ID** (A·B·@ …).
   *
   * `speaker` 는 역할·실명으로 덮여 저장되는데, 그러고 나면 **어느 것이 같은 사람인지
   * 알 방법이 사라진다.** 파일마다 A 부터 다시 매기므로 파트1 의 A 와 파트5 의 A 는
   * 아무 관계가 없는데, 라벨만 보면 구분할 수가 없다 (2026-08-20 · 화자 12명).
   * 구간 경계에서 격리하려면 이 값이 남아 있어야 한다.
   */
  speaker_raw?: string
  /**
   * 화면에 그대로 나가는 이름. 격리된 화자는 `구간 2 · 고객` 처럼 **어느 구간의 누구인지**를
   * 밝힌다 — `P2:B` 는 사람이 읽을 말이 아니고, 그냥 `고객` 이면 다른 구간의 다른 사람과
   * 같아 보인다. 분석 워크플로가 붙인다 (2026-08-22).
   */
  speaker_label?: string
  /**
   * 이 줄이 원래 **몇 번 연속으로 나왔나**. 1 이면 안 접혔다는 뜻이라 붙이지 않는다.
   * STT 가 주는 값이 아니라 `collapseRepeats` 가 붙인다 (2026-08-20).
   */
  repeated?: number
  /**
   * 이 줄이 나온 녹음 (012). STT 가 주는 값이 아니라 **분석 워크플로가 붙인다** —
   * 미팅 하나에 녹음이 여러 개면 각자의 시각이 0부터라, 출처를 알아야 재생 위치가 선다.
   */
  recording_id?: string
}
/**
 * 전사가 **어떻게** 끝났는지. 성공 여부와 별개다 (014).
 *
 * 2026-08-20 에 겪은 것이 전부 "성공했는데 등급이 내려간 것" 이었다 —
 * diarize 가 거절돼 whisper 로 떨어져 화자가 사라지고, 등록한 목소리가 하나도 안 붙고,
 * 그런데 화면에도 로그에도 정상으로 보였다. 그 침묵을 여기서 깬다.
 */
export interface SttNotes {
  /** whisper 면 **화자 정보가 없다.** 세그먼트가 통째로 하나가 된다. */
  engine: 'diarize' | 'whisper'
  /** 등록 목소리를 몇 개 넘겼나 */
  enrolled: number
  /** 그중 실제로 실명이 돌아온 화자 수. `enrolled > 0` 인데 0 이면 매칭이 실패한 것이다. */
  matched: number
  /** STT 를 몇 번 불렀나 (5xx 재시도 포함) */
  attempts: number
  /** 4xx 로 거절돼 등록 없이 다시 불렀나 */
  retried_without_refs: boolean
  /** 반복 루프를 몇 줄 접었나 */
  collapsed: number
  /** whisper 로 떨어진 이유 */
  diarize_error?: string
}

export interface SttResult { text: string; segments: DiarizedSegment[]; notes: SttNotes }

const chatModel = (env: Env) => env.OPENAI_MODEL || CHAT

async function chat(env: Env, body: Record<string, unknown>): Promise<unknown | null> {
  if (!env.OPENAI_API_KEY) return null
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: chatModel(env), ...body }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`OpenAI ${r.status}: ${detail.slice(0, 300)}`)
  }
  const d = await r.json<{ choices?: { message?: { content?: string } }[] }>()
  const content = d.choices?.[0]?.message?.content
  return content ? JSON.parse(content) : null
}

// ───────────────────────────── STT

/**
 * ─── 반복 루프 방어 (2026-08-20)
 *
 * Whisper 계열은 **정보가 적은 구간(무음·잡음·웅얼거림)에서 직전 문장을 되풀이**한다.
 * 언어가 어긋나면 들리는 소리를 억지로 맞추느라 더 심해진다. 2026-08-20 신고에서
 * "So I explained." 가 50회 넘게 이어졌고, 그 녹취가 그대로 요약·점수의 입력이 됐다.
 *
 * **버리지 않고 접는다.** 정말 같은 말을 반복한 회의도 있으므로 앞 {@link REPEAT_RUN_MAX}
 * 개는 남기고, 몇 번이었는지를 `repeated` 에 적는다.
 */
const REPEAT_RUN_MAX = 3

/** 비교용으로만 쓰는 정규화. 공백·문장부호·대소문자 차이는 같은 문장으로 본다. */
function repeatKey(t: string): string {
  return t.trim().toLowerCase().replace(/[\s.,!?…·"'`~\-—]+/g, '')
}

/** 한 세그먼트 **안에서** 같은 문장이 이어지는 것을 접는다 (whisper 폴백은 전체가 한 덩이다). */
function collapseWithin(text: string): { text: string; runs: number } {
  const parts = text.match(/[^.!?。…]+[.!?。…]*\s*/g)
  if (!parts || parts.length < 2) return { text, runs: 0 }
  const out: string[] = []
  let runs = 0, key = '', run = 0
  for (const part of parts) {
    const k = repeatKey(part)
    if (!k) { out.push(part); continue }
    if (k === key) {
      run++
      if (run > REPEAT_RUN_MAX) { runs++; continue }
    } else { key = k; run = 1 }
    out.push(part)
  }
  return { text: runs ? out.join('').trimEnd() : text, runs }
}

/**
 * 같은 화자가 같은 말을 연달아 하는 구간을 접는다.
 * @returns 접힌 세그먼트와, 몇 줄을 접었는지
 */
export function collapseRepeats(segments: DiarizedSegment[]): { segments: DiarizedSegment[]; dropped: number } {
  const out: DiarizedSegment[] = []
  let dropped = 0
  let key = '', run = 0

  for (const raw of segments) {
    const inner = collapseWithin(raw.text)
    dropped += inner.runs
    const s: DiarizedSegment = { ...raw, text: inner.text }
    const k = repeatKey(s.text)
    const prev = out[out.length - 1]

    if (k && prev && prev.speaker === s.speaker && k === key) {
      run++
      // 앞 REPEAT_RUN_MAX 개는 남긴다. 그 뒤부터는 접되 **시각은 이어 붙인다** —
      // 접힌 줄만큼 오디오가 사라지면 재생 위치가 어긋난다.
      if (run > REPEAT_RUN_MAX) {
        prev.end_ms = Math.max(prev.end_ms, s.end_ms)
        prev.repeated = run
        dropped++
        continue
      }
    } else { key = k; run = 1 }
    out.push(s)
  }
  return { segments: out, dropped }
}

/** diarized_json 응답을 표준 세그먼트로. 초→ms 는 방어적으로 처리한다(원본 그대로). */
function parseDiarized(raw: {
  segments?: { speaker?: unknown; speaker_id?: unknown; speaker_label?: unknown
               start?: number; end?: number; start_ms?: number; end_ms?: number; text?: string }[]
  text?: string
}): { text: string; segments: DiarizedSegment[]; collapsed: number } {
  const parsed: DiarizedSegment[] = (raw?.segments || []).map((s) => ({
    speaker: String(s.speaker ?? s.speaker_id ?? s.speaker_label ?? 'A'),
    start_ms: s.start_ms ?? (s.start != null ? Math.round(s.start * 1000) : 0),
    end_ms: s.end_ms ?? (s.end != null ? Math.round(s.end * 1000) : 0),
    text: s.text ?? '',
  }))
  // **여기서 접는다.** 이 함수를 지나면 반복 루프는 남아 있지 않다 (2026-08-20).
  const { segments, dropped } = collapseRepeats(parsed)
  if (dropped) console.warn(`STT repetition collapsed: ${dropped} run(s) folded of ${parsed.length} segments`)
  // 원문 text 는 접히기 전 기준이라 다시 만든다 — 안 그러면 요약이 접기 전 문장을 본다
  return {
    text: dropped || !raw?.text ? segments.map((s) => s.text).join(' ') : raw.text,
    segments,
    collapsed: dropped,
  }
}

/**
 * 화자 분리 STT. 실패하면 whisper-1 로 떨어진다(화자 정보 없음) — 원본과 같은 2단 구조.
 * 오디오는 R2 객체에서 온다. 사내 백엔드는 로컬 경로를 열었다.
 */
/** 등록한 목소리 하나. 클립은 data URL 이어야 한다(multipart 사용 시 API 요구). */
export interface KnownSpeaker { name: string; dataUrl: string }

export async function transcribeAudio(
  env: Env, audio: Blob, filename: string, known: KnownSpeaker[] = [],
): Promise<SttResult | null> {
  if (!env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not configured - skipping STT')
    return null
  }

  const build = (refs: KnownSpeaker[]): FormData => {
    const form = new FormData()
    form.append('file', audio, filename)
    form.append('model', env.OPENAI_STT_DIARIZE_MODEL || STT_DIARIZE)
    form.append('response_format', 'diarized_json')
    form.append('chunking_strategy', 'auto')
    // **언어를 고정한다.** 안 보내면 구간마다 자동 판별이 돌고, 영어 낱말이 섞인
    // 한국어 회의에서 영어로 넘어간다 (2026-08-20).
    form.append('language', env.OPENAI_STT_LANGUAGE || STT_LANGUAGE)
    // 등록된 목소리는 화자 ID 대신 **실명**으로 돌아온다.
    // 등록하지 않은 사람은 화자 A·B·C 로 남는다 — 그게 의도다(§008 마이그레이션).
    for (const k of refs) {
      form.append('known_speaker_names[]', k.name)
      form.append('known_speaker_references[]', k.dataUrl)
    }
    return form
  }

  const call = (refs: KnownSpeaker[]) =>
    fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: build(refs),
    })

  let attempts = 0
  let retriedWithout = false
  let diarizeError = ''

  /**
   * 5xx·네트워크 오류는 **한 번 더 시도한다.**
   *
   * 그전에는 4xx 만 (등록 없이) 다시 걸고 5xx·타임아웃은 그 자리에서 포기해 whisper 로 떨어졌다.
   * 재시도 장치가 둘인데 둘 다 무력했다 — `TranscribeWorkflow` 에도 `retries` 가 있지만
   * **whisper 폴백이 성공을 돌려주므로 워크플로는 다시 시도할 일이 없다고 판단한다.**
   * 일시적 오류 한 번에 그 조각의 화자가 영구히 사라진다 (2026-08-20 파트3).
   */
  const callRetrying = async (refs: KnownSpeaker[]): Promise<Response> => {
    let last: Response | null = null
    for (let i = 0; i < 2; i++) {
      attempts++
      try {
        const r = await call(refs)
        if (r.ok || r.status < 500) return r      // 4xx 는 다시 걸어도 같다
        last = r
      } catch (e) {
        if (i === 1) throw e                       // 네트워크 오류도 한 번은 더 본다
      }
      if (i === 0) await new Promise((ok) => setTimeout(ok, 1500))
    }
    if (last) return last
    throw new Error('STT 요청이 응답하지 않았습니다')
  }

  // 1) 화자 분리
  try {
    let r = await callRetrying(known)
    // 클립 형식·인원 한도로 거절되면 **등록 없이 한 번 더**.
    // 실명이 안 붙는 것보다 분석 자체가 실패하는 쪽이 훨씬 나쁘다 (v1 에서 같은 결론).
    if (!r.ok && known.length > 0 && r.status >= 400 && r.status < 500) {
      const detail = (await r.text().catch(() => '')).slice(0, 200)
      console.warn(`STT rejected with ${known.length} voice ref(s) (${r.status}): ${detail} — retrying without`)
      retriedWithout = true
      r = await callRetrying([])
    }
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
    const parsed = parseDiarized(await r.json())
    // 등록한 이름이 화자 자리에 그대로 돌아온 것만 센다.
    // 넘겼는데 0 이면 매칭이 실패한 것이고, 그 사실이 지금까지 아무 데도 남지 않았다.
    const names = new Set(known.map((k) => k.name))
    const matched = retriedWithout
      ? 0
      : new Set(parsed.segments.map((sg) => sg.speaker).filter((sp) => names.has(sp))).size
    console.log(`diarized STT ok (${parsed.text.length} chars, ${parsed.segments.length} segments`
      + `${known.length ? `, ${known.length} enrolled → ${matched} matched` : ''})`)
    if (known.length && !matched) {
      console.warn(`voice enrollment did not match any speaker (${known.length} ref(s) sent)`)
    }
    return {
      text: parsed.text,
      segments: parsed.segments,
      notes: {
        engine: 'diarize', enrolled: known.length, matched, attempts,
        retried_without_refs: retriedWithout, collapsed: parsed.collapsed,
      },
    }
  } catch (e) {
    diarizeError = e instanceof Error ? e.message : String(e)
    console.warn(`diarizing STT failed (${diarizeError}) — falling back to whisper-1`)
  }

  // 2) whisper 폴백
  try {
    const form = new FormData()
    form.append('file', audio, filename)
    form.append('model', env.OPENAI_STT_MODEL || STT_PLAIN)
    // 폴백에도 같은 언어를 건다. 여기가 빠지면 주경로만 고친 셈이 된다.
    form.append('language', env.OPENAI_STT_LANGUAGE || STT_LANGUAGE)
    // **폴백에도 재시도를 건다.** 주경로만 감싸면 여기서 5xx 한 번에 전사가 통째로
    // 비어 돌아오고, 그러면 그 조각은 분석에서 아예 빠진다 —
    // 화자가 사라지는 것보다 한 단계 더 나쁘다. (V3 세션이 짚어 준 자리다)
    let r: Response | null = null
    for (let i = 0; i < 2; i++) {
      attempts++
      try {
        r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: form,
        })
        if (r.ok || r.status < 500) break
      } catch (err) {
        if (i === 1) throw err
      }
      if (i === 0) await new Promise((ok) => setTimeout(ok, 1500))
    }
    if (!r) throw new Error('whisper 요청이 응답하지 않았습니다')
    if (!r.ok) throw new Error(`${r.status}`)
    const d = await r.json<{ text?: string }>()
    const raw = d.text ?? ''
    // 폴백은 전체가 한 덩이다 — 세그먼트 사이가 아니라 **문장 사이**를 접어야 한다.
    const { segments, dropped } = collapseRepeats(raw ? [{ speaker: 'A', start_ms: 0, end_ms: 0, text: raw }] : [])
    const text = segments[0]?.text ?? ''
    if (text.length !== raw.length) console.warn(`whisper repetition collapsed: ${raw.length} → ${text.length} chars`)
    // **화자 정보가 없다는 사실을 행에 남긴다.** 이게 없으면 620초가 세그먼트 1개로
    // 저장된 것이 화면에서 정상으로 보인다 (2026-08-20 파트3).
    console.warn(`whisper STT ok but DEGRADED (${text.length} chars, no diarization)`)
    return {
      text,
      segments,
      notes: {
        engine: 'whisper', enrolled: known.length, matched: 0, attempts,
        retried_without_refs: retriedWithout, collapsed: dropped,
        diarize_error: diarizeError.slice(0, 300),
      },
    }
  } catch (e) {
    console.error(`whisper STT error: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

// ───────────────────────────── 화자 역할

/**
 * 가장 많이 말한 화자를 변호사로 본다. LLM 실패 시의 폴백.
 *
 * **LEP 은 어떤 미팅이든 「변호사 ↔ 의뢰인」이다.** 수임 상담(BD)도 잠재 의뢰인을
 * 만나는 자리이지 영업 상담이 아니다. SEP 의 「영업대표/고객」을 그대로 두면
 * 변호사가 자기 녹취에서 자신을 「영업대표」로 보게 된다.
 */
function fallbackRoles(segments: DiarizedSegment[], speakers: string[]): Record<string, string> {
  const counts: Record<string, number> = {}
  for (const s of segments) counts[s.speaker] = (counts[s.speaker] || 0) + s.text.length
  const rep = speakers.reduce((a, b) => ((counts[a] || 0) >= (counts[b] || 0) ? a : b), speakers[0])
  return Object.fromEntries(speakers.map((sp) => [sp, sp === rep ? '변호사' : '의뢰인']))
}

/**
 * 역할을 물어볼 화자 수의 상한.
 *
 * 넘는 것은 말수가 적은 쪽부터 잘린다. 45명을 통째로 넣으면 프롬프트가 부풀고
 * 모델이 대부분을 놓쳐 **전부 미판정**이 된다 — 아무것도 못 얻는 것보다
 * 주요 화자만이라도 얻는 것이 낫다.
 */
const MAX_ROLE_SPEAKERS = 16

/** 화자 식별자를 역할로만 매핑한다. **이름은 추정하지 않는다**(안티-할루시네이션). */
export async function mapSpeakerRoles(
  env: Env, segments: DiarizedSegment[],
): Promise<Record<string, string>> {
  const all = Array.from(new Set(segments.map((s) => s.speaker)))
  if (all.length <= 1) return { [all[0] ?? 'A']: '변호사' }
  if (!env.OPENAI_API_KEY) return fallbackRoles(segments, all)

  /**
   * **말수 순으로 세우고 위에서부터 본다** (2026-08-27).
   *
   * 구간이 여러 개인 녹음은 화자가 45명까지 갈린다 — 구간마다 STT 가 새로 매기고,
   * 겹침이 없으면 이을 수 없기 때문이다. 그대로 다 넣으면 프롬프트가 부풀고
   * 모델이 대부분을 판정하지 못해 **전부 미판정으로 떨어진다.**
   *
   * 말수가 많은 쪽이 그 미팅의 주인공이다. 아래쪽 토막들은 판정해도 지표를 못 바꾼다.
   */
  const words = new Map<string, number>()
  for (const s of segments) {
    const n = s.text.trim() ? s.text.trim().split(/\s+/).length : 0
    words.set(s.speaker, (words.get(s.speaker) || 0) + n)
  }
  const speakers = [...all].sort((a, b) => (words.get(b) || 0) - (words.get(a) || 0)).slice(0, MAX_ROLE_SPEAKERS)

  try {
    /**
     * **숫자로 묻는다** (2026-08-27).
     *
     * 예전에는 화자 ID 를 그대로 키로 썼다. 그런데 구간이 여러 개면 그 ID 가
     * `P1:A`·`P3:B` 같은 모양이라, 모델이 `{"P1:A": "변호사"}` 로 정확히 돌려주지 못한다 —
     * 콜론을 빼거나 「화자 」 를 붙여 오면 `p[sp]` 가 빗나가고 **전부 미판정**이 된다.
     * 2026-08-27 실측: 45명 중 하나도 판정되지 않고 「미상 8818단어」 가 나왔다.
     *
     * `1`·`2`·`3` 으로 물으면 틀릴 여지가 없다. 되돌려 붙이는 것은 우리 몫이다.
     */
    const samples = speakers.map((sp, i) => {
      // 골고루 뽑는다. 앞 5줄만 보면 인사말만 들어가 누가 누군지 안 드러난다.
      const mine = segments.filter((s) => s.speaker === sp)
      const step = Math.max(1, Math.floor(mine.length / 6))
      const sample = mine.filter((_, k) => k % step === 0).slice(0, 6).map((s) => s.text).join(' ')
      return `${i + 1}: ${sample.slice(0, 400)}`
    }).join('\n')

    const parsed = await chat(env, {
      messages: [
        { role: 'system', content:
          '번호별 발화 샘플을 보고 각 번호가 "변호사"인지 "의뢰인"인지 판정한다. '
          + '법률 상담·수임 상담 어느 쪽이든 상담을 이끄는 쪽이 변호사다. '
          + '**받은 번호를 하나도 빠뜨리지 않는다.** 애매하면 더 그럴듯한 쪽을 고른다. '
          + '이름은 판정하지 않는다. 역할만 정한다. '
          + 'JSON만 출력: {"1":"변호사","2":"의뢰인",…}' },
        { role: 'user', content: samples },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }) as Record<string, string> | null
    const p = parsed || {}
    // 번호를 되돌려 붙인다. 모델이 `1`·`"1"`·`화자 1` 어느 쪽으로 답해도 받는다.
    const got = new Map<string, string>()
    speakers.forEach((sp, i) => {
      const v = p[String(i + 1)] ?? p[`화자 ${i + 1}`] ?? p[`${i + 1}번`]
      if (v === '변호사' || v === '의뢰인') got.set(sp, v)
    })
    logLine('info', 'roles.mapped', {
      asked: speakers.length, got: got.size, total: all.length,
    })
    // 판정하지 못한 것과 **애초에 안 물어본 것**을 같이 담는다 — 둘 다 원래 이름으로 둔다.
    return Object.fromEntries(all.map((sp) => [sp, got.get(sp) ?? `화자 ${sp}`]))
  } catch (e) {
    console.warn(`speaker role mapping failed: ${e instanceof Error ? e.message : e} — talk-volume fallback`)
    return fallbackRoles(segments, all)
  }
}

// ───────────────────────────── 리포트 3종

export interface Meeting { id: string; title: string; notes?: string | null
                           startTime?: string | null; endTime?: string | null }

export async function generateReport(
  env: Env, meeting: Meeting, transcription: string, previousContext?: string,
) {
  if (!env.OPENAI_API_KEY || !transcription) return null
  const ctx = previousContext ? `\n[이전 미팅 맥락]\n${previousContext}\n` : ''
  const notes = meeting.notes ? `\n[영업자 사전 메모]\n${meeting.notes}\n` : ''
  const p = await chat(env, {
    messages: [
      { role: 'system', content:
        '당신은 B2B 세일즈 미팅 분석 전문가다. 영업 미팅 녹취 전문을 분석해 반드시 JSON 하나만 출력한다.\n'
        + '{ "summary": "미팅 핵심 요약 (2~4문장)", "interests": ["고객 관심사"], "concerns": ["고객 우려사항"], '
        + '"deal_signals": ["가격 저항, 경쟁사 언급, 도입 의지 등 계약 신호"], "action_items": ["후속 조치"], '
        + '"follow_up_draft": "고객에게 보낼 팔로업 이메일 초안 (인사말 포함)" }\n'
        + '단정적 판단 대신 신호 중심으로 서술한다. 모든 출력은 한국어로만.' },
      { role: 'user', content: `[미팅 제목] ${meeting.title}${notes}${ctx}\n[녹취]\n${transcription.slice(0, 12000)}` },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  }) as Record<string, unknown> | null
  if (!p) return null
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    summary: (p.summary as string) || '',
    interests: arr(p.interests),
    concerns: arr(p.concerns),
    deal_signals: arr(p.deal_signals),
    action_items: arr(p.action_items),
    follow_up_draft: (p.follow_up_draft as string) || '',
  }
}

export async function generatePsychCoaching(
  env: Env, transcription: string, talkMetrics?: unknown, previousContext?: string,
) {
  if (!env.OPENAI_API_KEY || !transcription) return null
  const ctx = previousContext ? `\n[이전 미팅 맥락]\n${previousContext}\n` : ''
  const metrics = talkMetrics ? `\n[대화 지표]\n${JSON.stringify(talkMetrics)}\n` : ''
  const p = await chat(env, {
    messages: [
      { role: 'system', content:
        '당신은 세일즈 심리 분석 코치다. 음성/톤 정보는 없고, 오직 대화 텍스트와 계산된 지표에서만 근거를 찾는다.\n'
        + '반드시 JSON 하나만: {"psych_insights":{"customer_state":"고객 심리 상태","rep_confidence":"영업자 자신감","answer_quality":"답변 품질","responsiveness":"고객 반응성","notes":["관찰 근거"]},"coaching":{"direction":"코칭 방향","preparation":["다음 미팅 준비"],"checklist":["체크리스트"],"next_appointment":"다음 약속 제안"}}\n모든 출력 한국어.' },
      { role: 'user', content: `${metrics}${ctx}[녹취]\n${transcription.slice(0, 12000)}` },
    ],
    temperature: 0.7,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
  }) as { psych_insights?: Record<string, unknown>; coaching?: Record<string, unknown> } | null
  if (!p) return null
  const pi = p.psych_insights || {}
  const co = p.coaching || {}
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    psych_insights: {
      customer_state: (pi.customer_state as string) || '',
      rep_confidence: (pi.rep_confidence as string) || '',
      answer_quality: (pi.answer_quality as string) || '',
      responsiveness: (pi.responsiveness as string) || '',
      notes: arr(pi.notes),
    },
    coaching: {
      direction: (co.direction as string) || '',
      preparation: arr(co.preparation),
      checklist: arr(co.checklist),
      next_appointment: (co.next_appointment as string) || '',
    },
  }
}

const AXES = ['question_skill', 'listening_balance', 'objection_handling',
              'value_articulation', 'closing_next_steps'] as const

/** 5축 스코어카드. **total 은 모델이 준 값을 쓰지 않고 서버에서 평균으로 다시 낸다**(원본 그대로). */
export async function generateScorecard(env: Env, transcription: string) {
  if (!env.OPENAI_API_KEY || !transcription) return null
  const p = await chat(env, {
    messages: [
      { role: 'system', content:
        'B2B 세일즈 역량 평가자다. 5개 축을 각 0~100으로 평가하고 근거·조언을 단다.\n'
        + '축: question_skill(질문 기술), listening_balance(경청·발화 균형; 영업 발화 40~60%가 이상적), objection_handling(오브젝션 대응), value_articulation(가치 전달), closing_next_steps(클로징·다음 단계).\n'
        + '반드시 JSON 하나만: {"axes":{"question_skill":{"score":0,"evidence":"","advice":""},"listening_balance":{"score":0,"evidence":"","advice":""},"objection_handling":{"score":0,"evidence":"","advice":""},"value_articulation":{"score":0,"evidence":"","advice":""},"closing_next_steps":{"score":0,"evidence":"","advice":""}},"headline":"한줄평"}\n'
        + '90+ 탁월, 50 보통, 20- 미흡. 모든 출력 한국어.' },
      { role: 'user', content: transcription.slice(0, 12000) },
    ],
    temperature: 0.4,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
  }) as { axes?: Record<string, { score?: unknown; evidence?: string; advice?: string }>; headline?: string } | null
  if (!p) return null
  const axes: Record<string, { score: number; evidence: string; advice: string }> = {}
  let sum = 0
  for (const k of AXES) {
    const a = p.axes?.[k] || {}
    const score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)))
    axes[k] = { score, evidence: a.evidence || '', advice: a.advice || '' }
    sum += score
  }
  return { axes, total: Math.round(sum / AXES.length), headline: p.headline || '' }
}

// ───────────────────────────── 대시보드용 기본 분석

function analysisPrompt(meeting: Meeting, transcription?: string): string {
  const durationMinutes = Math.ceil(
    (new Date(meeting.endTime || 0).getTime() - new Date(meeting.startTime || 0).getTime()) / 60000)

  if (transcription) {
    return `Analyze this sales meeting:

Title: ${meeting.title}
Duration: ${durationMinutes} minutes
Transcription:
${transcription}

Provide analysis in this exact JSON format:
{
  "customer_needs": {
    "primary": "main need identified",
    "secondary": ["need 2", "need 3"],
    "budget": "budget information or 'not discussed'",
    "timeline": "timeline or 'not specified'",
    "decision_makers": 1,
    "confidence": 0.0
  },
  "deal_signals": {
    "signal": "positive",
    "strength": 8.0,
    "closing_probability": 0.7,
    "competition": "competitor name or 'none'",
    "next_steps": "specific next action"
  },
  "scores": {
    "customer_understanding": 80,
    "problem_solving": 85,
    "proposal_persuasion": 75,
    "follow_up": 70,
    "team_collaboration": 80,
    "overall": 78
  },
  "sentiment": "positive",
  "key_points": ["key point 1", "key point 2", "key point 3"]
}

**모든 문자열 값은 한국어로 쓴다.** 값이 없을 때도 한국어로 — 예산은 "논의되지 않음",
일정은 "명시되지 않음", 경쟁사는 "없음" 이라고 쓴다. \`positive\`/\`neutral\`/\`negative\` 같은
열거값과 숫자는 그대로 둔다 — 화면과 통계가 그 값으로 판정한다.`
  }

  // 전사문이 없을 때. 원본은 여기서 모델에게 "realistic analysis 를 생성" 하라고 지시한다 —
  // **제목만 보고 예산·성사 확률을 지어내라는 뜻이다.** 옮기면서 문구는 바꾸지 않았고,
  // 대신 이 경로로 들어온 결과에는 호출부가 경고 문장을 붙인다(원본도 그렇게 한다).
  return `Analyze this sales meeting based on metadata:

Title: ${meeting.title}
Duration: ${durationMinutes} minutes

Generate realistic analysis for this meeting in this JSON format:
{
  "customer_needs": { "primary": "", "secondary": [], "budget": "", "timeline": "", "decision_makers": 1, "confidence": 0.6 },
  "deal_signals": { "signal": "positive", "strength": 7.0, "closing_probability": 0.6, "competition": "none", "next_steps": "" },
  "scores": { "customer_understanding": 70, "problem_solving": 70, "proposal_persuasion": 70, "follow_up": 70, "team_collaboration": 70, "overall": 70 },
  "sentiment": "neutral",
  "key_points": []
}

**모든 문자열 값은 한국어로 쓴다.** 열거값과 숫자는 그대로 둔다.`
}

export async function analyzeMeeting(env: Env, meeting: Meeting, transcription?: string) {
  const p = await chat(env, {
    messages: [
      { role: 'system', content: `You are an expert sales coach analyzing sales meetings.
Analyze the meeting and provide insights in JSON format.
Focus on: customer needs, deal signals, communication effectiveness, and next steps.
Respond ONLY with valid JSON, no additional text.

**Write every string value in Korean.** 사용자가 읽는 화면이 한국어다 — 값이 없을 때의
기본 문구도 한국어로 쓴다("논의되지 않음", "명시되지 않음", "없음").
JSON 키, 열거값(positive/neutral/negative), 숫자는 영어·원형 그대로 둔다.` },
      { role: 'user', content: analysisPrompt(meeting, transcription) },
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  }) as {
    customer_needs: Record<string, unknown>; deal_signals: Record<string, unknown>
    scores: Record<string, number>; sentiment: string; key_points: string[]
  } | null
  if (!p) return null
  return {
    meetingId: meeting.id,
    customerNeeds: {
      primary: p.customer_needs.primary,
      secondary: p.customer_needs.secondary,
      budget: p.customer_needs.budget,
      timeline: p.customer_needs.timeline,
      decisionMakers: p.customer_needs.decision_makers,
      confidence: p.customer_needs.confidence,
    },
    dealSignals: {
      signal: p.deal_signals.signal,
      strength: p.deal_signals.strength,
      closingProbability: p.deal_signals.closing_probability,
      competition: p.deal_signals.competition,
      nextSteps: p.deal_signals.next_steps,
    },
    scores: {
      customerUnderstanding: p.scores.customer_understanding,
      problemSolving: p.scores.problem_solving,
      proposalPersuasion: p.scores.proposal_persuasion,
      followUp: p.scores.follow_up,
      teamCollaboration: p.scores.team_collaboration,
      overall: p.scores.overall,
    },
    sentiment: p.sentiment,
    keyPoints: p.key_points,
    createdAt: new Date().toISOString(),
  }
}

// ─────────── 리뷰용 미팅 노트 (클로바노트/다글로 형식)

export interface MeetingNote {
  headline: string
  /**
   * `part` 는 이 주제가 **녹취의 몇 번째 구간에서 나왔는지**다 (0부터).
   * 화면이 "지금 보는 녹취 줄"과 "노트의 어느 주제"를 잇는 데 쓴다.
   *
   * LLM 에게 물어서 얻는 값이 아니다 — 이미 구간별로 나눠 요약하고 있으므로
   * 그 순서를 적어 두기만 하면 된다. 추가 호출도 프롬프트 변경도 없다.
   * `part` 가 없는 옛 노트는 화면이 비율로 폴백한다.
   */
  topics: { title: string; points: string[]; part?: number }[]
  /** 녹취를 몇 구간으로 나눴는가. 한 번에 들어간 경우 1. */
  partCount?: number
  decisions: string[]
  open_items: string[]
  next_steps: string[]
  mentions: { kind: string; value: string }[]
}

/**
 * 한 번에 모델에 넣는 녹취 길이.
 *
 * 기존 요약은 12,000자에서 잘랐다. 40분 미팅 15,019자 중 **뒤 21%(발화 81개)가 통째로 빠졌고**,
 * 하필 미팅 끝에 결정과 다음 약속이 나온다 — 리뷰용 노트에서 가장 중요한 부분이다.
 * 그래서 자르는 대신 나눈다.
 */
const NOTE_WINDOW = 12000

const NOTE_SHAPE =
  '{ "headline": "이 미팅이 무엇이었는지 한 줄", '
  + '"topics": [{"title": "주제", "points": ["요점"]}], '
  + '"decisions": ["합의·확정된 것"], "open_items": ["답을 못 준 것, 확인이 필요한 것"], '
  + '"next_steps": ["약속된 다음 행동·일정"], '
  + '"mentions": [{"kind": "금액|일정|사람|회사|기타", "value": "언급된 값"}] }'

const NOTE_RULES =
  '**녹취에 실제로 나온 것만 쓴다.** 추론하거나 채워 넣지 않는다 — '
  + '나중에 이 노트만 보고 미팅을 되짚을 사람이 읽는다. 없으면 빈 배열로 둔다.\n'
  + '주제는 대화 순서대로 3~7개. 각 주제의 요점은 1~4개.\n'
  // mentions 를 형식에만 적어 두었더니 실제 녹취에 '다니엘 신'·'500원' 이 있는데도
  // 빈 배열이 왔다. 무엇을 넣어야 하는지 예시로 못박는다.
  + '**mentions 는 빠뜨리지 않는다.** 녹취에 나온 고유명사와 숫자를 그대로 옮긴다 — '
  + '사람 이름, 회사·브랜드명, 금액, 날짜·기간·요일, 수량. 나중에 기억이 흐려졌을 때 '
  + '확인하는 근거라 하나라도 있으면 반드시 넣는다.\n'
  + '예: [{"kind":"사람","value":"김민준 이사"},{"kind":"금액","value":"월 30만 원"},'
  + '{"kind":"일정","value":"다음 주 목요일 오후 2시"},{"kind":"회사","value":"고운기획"}]\n'
  + '모든 출력은 한국어. JSON 하나만.'

const emptyNote = (): MeetingNote => ({
  headline: '', topics: [], decisions: [], open_items: [], next_steps: [], mentions: [],
})

function asNote(p: Record<string, unknown> | null): MeetingNote {
  if (!p) return emptyNote()
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    headline: typeof p.headline === 'string' ? p.headline : '',
    topics: arr(p.topics)
      .map((t) => {
        const o = t as Record<string, unknown>
        return {
          title: typeof o?.title === 'string' ? o.title : '',
          points: arr(o?.points).filter((x): x is string => typeof x === 'string'),
        }
      })
      .filter((t) => t.title || t.points.length),
    decisions: arr(p.decisions).filter((x): x is string => typeof x === 'string'),
    open_items: arr(p.open_items).filter((x): x is string => typeof x === 'string'),
    next_steps: arr(p.next_steps).filter((x): x is string => typeof x === 'string'),
    mentions: arr(p.mentions)
      .map((m) => {
        const o = m as Record<string, unknown>
        return {
          kind: typeof o?.kind === 'string' ? o.kind : '기타',
          value: typeof o?.value === 'string' ? o.value : '',
        }
      })
      .filter((m) => m.value),
  }
}

/** 겹치는 항목을 없앤다. 구간 요약을 합치면 같은 말이 반복된다. */
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]

/**
 * 리뷰용 미팅 노트.
 *
 * 녹취가 길면 **구간별로 요약한 뒤 합친다.** 자르면 끝부분이 사라지는데,
 * 미팅의 결론은 대개 끝에 있다.
 */
export async function generateMeetingNote(
  env: Env, meeting: Meeting, transcription: string,
): Promise<MeetingNote | null> {
  if (!env.OPENAI_API_KEY || !transcription.trim()) return null
  const notes = meeting.notes ? `\n[영업자 사전 메모]\n${meeting.notes}\n` : ''

  const one = async (text: string, part?: string) => asNote(await chat(env, {
    messages: [
      { role: 'system', content:
        '당신은 미팅 기록 정리 전문가다. 녹취를 나중에 리뷰할 수 있는 노트로 정리한다.\n'
        + NOTE_SHAPE + '\n' + NOTE_RULES },
      { role: 'user', content:
        `[미팅 제목] ${meeting.title}${notes}${part ? `\n[구간] ${part}` : ''}\n[녹취]\n${text}` },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  }) as Record<string, unknown> | null)

  if (transcription.length <= NOTE_WINDOW) {
    const single = await one(transcription)
    return { ...single, partCount: 1, topics: single.topics.map((t) => ({ ...t, part: 0 })) }
  }

  // 구간별로 나눈다. 경계에서 문맥이 끊기지 않도록 조금 겹쳐 자른다.
  const OVERLAP = 500
  const parts: string[] = []
  for (let i = 0; i < transcription.length; i += NOTE_WINDOW - OVERLAP) {
    parts.push(transcription.slice(i, i + NOTE_WINDOW))
  }
  const partial = await Promise.all(
    parts.map((t, i) => one(t, `${i + 1}/${parts.length}`)),
  )

  // 합친다. 주제는 순서를 살려 이어 붙이고, 나머지는 중복만 없앤다.
  const merged: MeetingNote = {
    headline: partial.find((p) => p.headline)?.headline || '',
    // 어느 구간에서 나온 주제인지 함께 적는다. 순서는 이미 살아 있고, 여기서 출처만 붙인다.
    topics: partial.flatMap((p, i) => p.topics.map((t) => ({ ...t, part: i }))),
    partCount: parts.length,
    decisions: uniq(partial.flatMap((p) => p.decisions)),
    open_items: uniq(partial.flatMap((p) => p.open_items)),
    next_steps: uniq(partial.flatMap((p) => p.next_steps)),
    mentions: [],
  }
  const seen = new Set<string>()
  for (const m of partial.flatMap((p) => p.mentions)) {
    const k = `${m.kind}|${m.value}`
    if (!seen.has(k)) { seen.add(k); merged.mentions.push(m) }
  }
  // 헤드라인은 전체를 본 것이 아니므로 다시 만든다 — 첫 구간만 보면 "인사하고 시작했다" 가 된다.
  const overview = merged.topics.map((t) => `- ${t.title}: ${t.points.join(' / ')}`).join('\n')
  const head = await chat(env, {
    messages: [
      { role: 'system', content: '미팅 주제 목록을 보고 이 미팅을 한 줄로 요약한다. JSON 하나만: {"headline":"..."} 한국어.' },
      { role: 'user', content: `[제목] ${meeting.title}\n[주제]\n${overview}` },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }) as Record<string, unknown> | null
  if (head && typeof head.headline === 'string' && head.headline) merged.headline = head.headline
  return merged
}
