/**
 * 진술 분석 (IEP S4) — 조사 녹취에서 **확인할 점을 짚는다.**
 *
 * ── §0 대전제: 판정하지 않고 근거를 짚는다 ──────────────────
 *
 * 거짓말·심리·점수를 판정하지 않는다. 대신 **원문 인용과 함께** 네 가지를 짚는다:
 *   CONTRADICTION  같은 조사 안에서 서로 어긋나는 두 발언 (인용 2개)
 *   UNANSWERED     물었는데 다른 답이 온 곳 (질문 인용 + 답 인용)
 *   UNVERIFIED     확인 가능한데 근거가 안 나온 주장 (시간·장소·인물·금액) + 물어볼 질문
 *   ATTITUDE_SHIFT 특정 주제에서 회피·화제 전환이 반복되는 지점 (가리키기만)
 *
 * ── 인용 대조가 이 파일의 심장이다 ─────────────────────────
 *
 * 모델이 준 인용이 **실제 전사에 있는지 코드가 대조한다.** 없으면 그 항목을 버린다.
 * 이것이 「지어낸 근거」를 막는 유일한 방법이다. LEP 은 refs 를 세그먼트 id 로
 * 받아 이 대조가 없었다 — IEP 는 인용 문자열을 직접 대조한다.
 *
 * 전부 **참고 자료**다 (§6-B). 판단·조사 진행은 수사관이 한다.
 */
import type { Env } from '../lib/env'

export type FlagKind = 'CONTRADICTION' | 'UNANSWERED' | 'UNVERIFIED' | 'ATTITUDE_SHIFT'

export interface StatementFlag {
  kind: FlagKind
  /** 무엇이 어긋나는지·확인이 필요한지. **판정이 아니라 설명.** */
  detail: string
  /** 원문 인용. 모델이 전사에서 그대로 따온 것. 코드가 실재를 대조한다. */
  quotes: string[]
  /** 다음에 물어 확인할 질문 (UNVERIFIED 에 필수). 유도·압박이 아닌 열린 질문. */
  ask?: string
}

export interface StatementAnalysis {
  /** 조사 요지 (2~4문장). 중립. */
  summary: string
  /** 진술 요지 — 대상자가 말한 핵심. */
  key_points: string[]
  /** 확인할 점들. **인용 대조를 통과한 것만 남는다.** */
  flags: StatementFlag[]
  /** 다음 조사에서 확인할 사항. */
  next_checks: string[]
  confidence: number
}

const SCHEMA = {
  name: 'statement_analysis',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['summary', 'key_points', 'flags', 'next_checks', 'confidence'],
    properties: {
      summary: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
      flags: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['kind', 'detail', 'quotes', 'ask'],
          properties: {
            kind: { type: 'string', enum: ['CONTRADICTION', 'UNANSWERED', 'UNVERIFIED', 'ATTITUDE_SHIFT'] },
            detail: { type: 'string' },
            // 인용. 전사에서 **그대로** 따온다. 요약·바꿔쓰기 금지 (대조해야 하므로).
            quotes: { type: 'array', items: { type: 'string' } },
            ask: { type: 'string' },   // 없으면 빈 문자열
          },
        },
      },
      next_checks: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
} as const

const PERSONA = `당신은 대한민국 경찰 수사관의 조사를 돕는 분석 보조다.
조사 녹취를 읽고 **수사관이 확인해 볼 점**을 짚는다. **참고 자료**일 뿐, 판단은 수사관이 한다.

## 절대 하지 않는 것
- **거짓말·진실을 판정하지 않는다.** "거짓", "속인다", "신빙성", 점수를 쓰지 않는다.
- **대상자의 심리·감정을 추론하지 않는다.**
- **사람을 규정하지 않는다.** "대상자가 거짓말한다" 가 아니라 "이 두 발언이 어긋난다".

## 짚는 네 가지 (근거가 있을 때만)
- CONTRADICTION: 같은 조사 안에서 **서로 어긋나는 두 발언.** quotes 에 그 두 발언을 그대로.
- UNANSWERED: 수사관이 물었는데 **다른 답이 온 곳.** quotes 에 질문과 답을 그대로.
- UNVERIFIED: 확인 가능한 주장(시간·장소·인물·금액)인데 **근거가 안 나온 것.**
  quotes 에 그 주장을, ask 에 **다음에 물어 확인할 열린 질문**을. (유도·압박 금지)
- ATTITUDE_SHIFT: 특정 주제가 나올 때마다 **화제를 돌리거나 답을 피하는** 지점. 가리키기만 한다.

## 인용 규칙 (반드시)
- **quotes 는 녹취에서 그대로 따온다.** 요약·바꿔쓰기·추측 금지. 없으면 그 항목을 만들지 마라.
- CONTRADICTION·UNANSWERED 는 quotes 가 **2개 이상**이어야 한다.
- 근거(인용)가 없으면 **flags 에 넣지 마라.** 지어낸 근거는 조사를 망친다.

모든 출력은 한국어. 같은 녹취에서 같은 답이 나오도록 창의성을 쓰지 마라.`

export interface StatementInput {
  transcript: string
  /** 조사 종류. victim(피해자)이면 모순 짚기를 하지 않는다 (§6-A). */
  kind?: string
  /** 이전 조사 맥락 (있으면). */
  priorContext?: string
}

/** 문자열 정규화 — 공백·문장부호 차이를 흡수해 인용을 대조한다. */
function norm(s: string): string {
  return (s || '').replace(/\s+/g, '').replace(/[.,!?…·「」『』"'’”“()]/g, '')
}

/**
 * **인용 대조** — 모델이 준 quotes 가 실제 전사에 있는지 본다.
 * 하나라도 전사에 없으면 그 flag 를 버린다 (지어낸 근거 차단).
 * CONTRADICTION·UNANSWERED 는 검증된 인용이 2개 미만이면 버린다.
 */
export function groundFlags(flags: StatementFlag[], transcript: string): StatementFlag[] {
  const hay = norm(transcript)
  const out: StatementFlag[] = []
  for (const f of flags) {
    const grounded = (f.quotes || []).filter((q) => {
      const n = norm(q)
      return n.length >= 4 && hay.includes(n)   // 4글자 미만은 대조 신뢰도 낮아 버린다
    })
    if (grounded.length === 0) continue                       // 근거 0 → 버린다
    if ((f.kind === 'CONTRADICTION' || f.kind === 'UNANSWERED') && grounded.length < 2) continue
    if (f.kind === 'UNVERIFIED' && !(f.ask || '').trim()) continue   // 물어볼 질문 없으면 버린다
    out.push({ ...f, quotes: grounded })
  }
  return out
}

export async function analyzeStatement(
  env: Env, input: StatementInput,
): Promise<StatementAnalysis | null> {
  if (!env.OPENAI_API_KEY || !input.transcript.trim()) return null
  // **피해자 조사는 모순 짚기를 하지 않는다** (§6-A, 2차 피해 방지) — 요지만.
  const victimNote = input.kind === 'victim'
    ? '\n\n**이 조사는 피해자 조사다. CONTRADICTION·ATTITUDE_SHIFT 를 만들지 마라. '
      + '요지 정리와 확인이 필요한 사항(UNVERIFIED)만, 압박 없이.**'
    : ''
  const ctx = input.priorContext ? `\n[이전 조사 맥락]\n${input.priorContext}\n` : ''
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_LEGAL_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: PERSONA + victimNote },
          { role: 'user', content: `${ctx}\n[조사 녹취록]\n${input.transcript}` },
        ],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: SCHEMA },
      }),
    })
    if (!r.ok) {
      console.warn(`statement analysis failed: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
      return null
    }
    const d = await r.json<{ choices?: { message?: { content?: string } }[] }>()
    const content = d.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content) as StatementAnalysis
    // **인용 대조.** 지어낸 근거를 여기서 버린다.
    parsed.flags = groundFlags(parsed.flags ?? [], input.transcript)
    return parsed
  } catch (e) {
    console.error(`statement analysis error: ${e instanceof Error ? e.message : e}`)
    return null
  }
}
