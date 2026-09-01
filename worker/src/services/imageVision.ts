/**
 * 이미지 사실 분석 (S7-b) — 보이는 것을 적을 뿐, 판정하지 않는다.
 *
 * ── §0 을 이미지로 ──────────────────────────────────────────
 * "위조·조작·가짜·범죄·유죄·거짓" 을 말하지 않는다. 얼굴로 신원을 지목하지 않는다.
 * 문서면 텍스트(OCR)·사물·장면을 사실로 적고, 안 보이면 「판독 불가」로 둔다.
 * 출력에 항상 「이미지만으로 판단하지 않는다」 주의를 붙인다.
 */
import type { Env } from '../lib/env'

export interface ImageDescription {
  summary: string
  ocr_text: string
  objects: string[]
  caution: string
}

const SCHEMA = {
  name: 'image_description', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['summary', 'ocr_text', 'objects', 'caution'],
    properties: {
      summary: { type: 'string' },              // 한두 문장 사실 요약
      ocr_text: { type: 'string' },             // 보이는 글자 그대로 (없으면 빈 문자열)
      objects: { type: 'array', items: { type: 'string' } },  // 보이는 사물·장면
      caution: { type: 'string' },              // 항상 「이미지만으로 판단하지 않는다」
    },
  },
} as const

const SYSTEM = `당신은 경찰 수사관의 조사를 돕는 이미지 분석 보조다.
이미지를 보고 **보이는 것을 사실로만** 적는다. **참고 자료**일 뿐, 판단은 수사관이 한다.

## 절대 하지 않는 것
- **판정하지 않는다.** 「위조·조작·가짜·진짜·범죄·증거임·유죄·거짓·불법」 같은 말을 쓰지 마라.
- **사람을 지목하지 않는다.** 얼굴로 신원을 추정하지 마라("피의자다" 금지). "사람 N명" 까지만.
- **없는 것을 지어내지 마라.** 흐릿해 안 보이면 「판독 불가」라고 적어라.

## 적는 것
- summary: 보이는 것을 한두 문장으로. 예 "A4 문서 1장. 상단에 '계약서' 제목. 하단에 서명란 2곳."
- ocr_text: 이미지 속 글자를 **그대로**. 문서·표지판·화면의 텍스트. 없으면 빈 문자열.
- objects: 보이는 사물·장면 목록. 예 ["문서", "책상", "펜"].
- caution: 항상 "이미지만으로 판단하지 않습니다. 원본·맥락을 사람이 확인하십시오."

모든 출력은 한국어. 같은 이미지에서 같은 설명이 나오게 창의성을 쓰지 마라.`

/** 판정 어휘가 새어 나오면 후처리로 걸러 caution 으로 내린다 (이중 차단). */
const BANNED = /위조|조작|가짜|유죄|범죄자|거짓말|불법|범인/

export async function describeImage(
  env: Env, bytes: ArrayBuffer, mime: string, reason: string,
): Promise<ImageDescription | null> {
  if (!env.OPENAI_API_KEY) return null
  // 이미지를 data URI 로 (base64). **큰 배열을 한 번에 spread 하면 스택을 넘긴다** —
  // 32KB 씩 잘라 인코딩한다 (10MB 이미지도 안전).
  const arr = new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode(...arr.subarray(i, i + 0x8000))
  }
  const dataUri = `data:${mime};base64,${btoa(bin)}`
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_LEGAL_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [
            { type: 'text', text: `수사관이 적은 입력 이유: ${reason}\n이 이미지에서 보이는 것을 사실로만 적어라.` },
            { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          ] },
        ],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: SCHEMA },
      }),
    })
    if (!r.ok) {
      console.warn(`image vision failed: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
      return null
    }
    const d = await r.json<{ choices?: { message?: { content?: string } }[] }>()
    const content = d.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content) as ImageDescription
    // 후처리: 판정 어휘가 summary/objects 에 새면 비우고 caution 에 기록
    if (BANNED.test(parsed.summary)) {
      parsed.summary = parsed.summary.replace(BANNED, '[판정 표현 제거됨]')
    }
    parsed.objects = (parsed.objects ?? []).filter((o) => !BANNED.test(o))
    parsed.caution = parsed.caution || '이미지만으로 판단하지 않습니다. 원본·맥락을 사람이 확인하십시오.'
    return parsed
  } catch (e) {
    console.error(`image vision error: ${e instanceof Error ? e.message : e}`)
    return null
  }
}
