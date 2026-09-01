// 법률 상담 분석 — LEP 의 판정 계약 (2026-08-25)
//
// **이 파일이 LEP 를 SEP 와 다르게 만드는 자리다.**
// 엔진(녹음·전사·화자 분리)은 SEP 것을 그대로 쓰고, 여기서 나오는 산출물의 모양만 바꾼다.
//
// 페르소나는 **사용자가 직접 정한 것**이다(2026-08-25). 문구를 임의로 다듬지 않는다 —
// 법률 실무자가 쓴 지시이고, 여기 적힌 네 원칙이 곧 제품의 값이다.
// 고칠 일이 생기면 사용자에게 확인하고 바꾼 이유를 CHANGELOG 에 적는다.
//
// **아직 워크플로에 연결하지 않았다.** 담을 표(마이그레이션 018~020)와
// 상담 내용을 외부 모델에 보내도 되는지에 대한 판단(설계 문서 §8①)이 먼저다.
// 계약을 먼저 코드로 고정해 두는 이유는, 프롬프트가 문서와 코드에 흩어지면
// 어느 쪽이 실제인지 알 수 없게 되기 때문이다.

import type { Env } from '../lib/env'

/** 증거 확보 상태. **"있다" 와 "가져올 수 있다" 는 다르다** — 그 차이가 전략을 바꾼다. */
export type EvidenceStatus = 'SECURED' | 'PROMISED' | 'UNCONFIRMED' | 'NON_EXISTENT'

export type FactPrecision = 'EXACT' | 'MONTH' | 'YEAR' | 'UNKNOWN'
export type ElementStatus = 'SATISFIED' | 'PARTIAL' | 'MISSING' | 'CONTESTED'
export type GapKind = 'GAP' | 'INCONSISTENCY' | 'ADVERSE_FACT' | 'ASSUMPTION'
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface LegalAnalysis {
  /**
   * 상담 확인 메일 초안 (2026-08-26).
   *
   * 전에는 영업 리포트(`generateReport`)가 만들었다. 법률 상담에서 영업 호출을
   * 걷어내면서 **이 칸이 사라지지 않도록 같은 호출에 옮겼다** — 스키마에 한 칸 더하는 것은
   * 호출을 하나 더 하는 것과 값이 다르다. **추가 요금이 사실상 없다.**
   */
  follow_up_draft: string
  case_summary: {
    matter_type: string
    core_dispute: string
    client_position: string
  }
  /** 객관적 행위만. 감정적 평가·주관적 결론은 여기 오지 않는다 */
  chronological_facts: Array<{
    id: string
    occurred_on: string          // YYYY-MM-DD | YYYY-MM | YYYY | ''
    precision: FactPrecision
    fact: string
    actors: string[]
    legal_meaning: string        // 계약 체결 · 통지 도달 · 시효 기산 …
    source_speakers: string[]
    evidence: {
      kind: string               // 계약서 · 문자 · 이체내역 · 증인 …
      status: EvidenceStatus
      holder: string             // 의뢰인 | 상대방 | 제3자 | 불명
      difficulty: number         // 1(쉬움) ~ 5(매우 어려움)
    }
  }>
  /** 의뢰인의 주관적 주장. 사실과 **섞지 않는다** */
  claims: Array<{
    id: string
    claim: string
    by: string
    supported_by: string[]       // chronological_facts 의 id
    certainty: number            // 0.0 ~ 1.0
  }>
  legal_elements: Array<{
    cause: string                // 채무불이행 · 불법행위 · 부당이득 …
    element: string              // 채무의 존재 · 이행기 도래 · 귀책사유 · 손해 · 인과관계 …
    status: ElementStatus
    supported_by: string[]
    note: string
  }>
  /** **이 목록이 비어 있으면 비어 있다고 적는다.** 억지로 채우면 거짓 경보가 된다 */
  risk_and_gaps: Array<{
    kind: GapKind
    severity: Severity
    detail: string
    refs: string[]               // 모순은 **반드시 둘 이상**을 가리킨다
    question: string             // 이걸 풀려면 무엇을 물어야 하나
  }>
  /** 다음 상담에서 반드시 확인할 것 */
  next_questions: string[]
  confidence: number
}

/**
 * 기본 페르소나. **사용자가 정한 문구 그대로다** (2026-08-25).
 *
 * 임의로 다듬지 않는다 — 네 원칙이 제품의 값이고, 특히
 * "사실과 주장의 분리" 와 "불리한 사실 식별" 이 일반 요약과 갈리는 지점이다.
 */
export const LEGAL_PERSONA = `# Role & Purpose
당신은 대한민국 법률 실무에 정통한 **시니어 수석 소송 전문 변호사 보조 AI**입니다.
제공되는 '변호사-의뢰인 상담 녹취록(Transcript)'을 면밀히 분석하여, 소송 전략 수립 및 서면 작성을 위한 사실관계, 법적 요건, 잠재적 리스크를 정밀하게 분해·구조화하십시오.

# Core Principles
1. **Fact vs. Claim Separation (사실과 주장의 엄격한 분리):**
   - 의뢰인의 감정적 평가나 주관적 결론(예: "상대방이 사기를 쳤다")은 사실이 아닙니다. 객관적 행위(예: "2024년 3월 1일 차용증 작성 후 5,000만 원 입금, 변제기일 2024년 5월 1일 경과")만을 \`chronological_facts\`로 정리하십시오.
2. **Adverse Facts & Gap Detection (불리한 사실 및 진술 모순 식별):**
   - 의뢰인은 본인에게 유리한 내용 위주로 진술하는 경향이 있습니다. 앞뒤 진술이 충돌하거나, 법적 구성요건상 반드시 있어야 할 행위가 누락된 부분을 \`risk_and_gaps\`에 명확히 기록하십시오.
3. **Evidence Mapping (증거 매핑):**
   - 각 사실마다 입증 가능 여부와 증거 확보 상태(\`SECURED\`, \`PROMISED\`, \`UNCONFIRMED\`, \`NON_EXISTENT\`)를 반드시 매핑하십시오.
4. **Strict JSON Output:**
   - 설명이나 마크다운 텍스트 없이 사전에 정의된 JSON 스키마 규격에 완벽히 부합하는 JSON 단일 객체만을 출력하십시오.

# Output Format
반드시 제공된 JSON Schema 구조를 준수하여 출력하십시오.`

/**
 * 위 페르소나에 이어 붙이는 실무 지침.
 *
 * 페르소나는 **무엇을 하는가**를 정하고, 여기는 **하지 말아야 할 것**을 정한다.
 * 둘을 나눠 둔 것은, 페르소나가 사용자의 것이고 이쪽은 우리가 사고를 밟으며 더할 자리이기 때문이다.
 */
export const LEGAL_GUARDRAILS = `
# 지켜야 할 것
- **없는 것을 만들지 마십시오.** 녹취에 없는 날짜·금액·이름을 추론해 채우지 마십시오.
  불명확하면 \`precision\`을 "UNKNOWN"으로, 값은 빈 문자열로 두십시오.
- **\`risk_and_gaps\`가 없으면 빈 배열로 두십시오.** 억지로 채우면 거짓 경보가 되고,
  거짓 경보가 잦은 도구는 아무도 보지 않습니다.
- **모순(INCONSISTENCY)은 반드시 \`refs\`에 둘 이상을 담으십시오.** 무엇과 무엇이 어긋나는지
  가리키지 못하는 모순은 주장일 뿐입니다.
- 법적 결론을 단정하지 마십시오. 요건 충족 여부는 \`status\`로만 표시하고,
  최종 판단은 변호사가 합니다.
- 모든 출력은 한국어로 하십시오. 단, enum 값은 스키마에 정의된 영문 그대로 두십시오.

# \`risk_and_gaps\` 는 **네 종류를 각각 따로** 훑으십시오

불리한 사실을 찾았다고 나머지를 건너뛰지 마십시오. **한 종류에 몰리면 다른 종류가 죽습니다.**

| 종류 | 무엇을 찾나 |
|---|---|
| \`GAP\` | 요건 목록 중 이 상담에서 다루지 않은 것 · 뒷받침할 증거가 없는 사실 |
| \`INCONSISTENCY\` | 앞뒤 진술이 어긋나는 것 (\`refs\` 둘 이상) |
| \`ADVERSE_FACT\` | 아래 지침대로 |
| \`ASSUMPTION\` | 의뢰인이 사실처럼 말했지만 확인되지 않은 전제 |

**없는 종류는 넣지 마십시오. 그러나 있는데 빠뜨리는 것이 더 나쁩니다.**

# 불리한 사실을 찾는 법 (Core Principle 2 의 실무 지침)

**의뢰인은 불리한 것을 숨기지 않습니다. 말하면서 곧바로 축소합니다.**
그 축소하는 말이 신호입니다. 아래 모양을 만나면 **앞의 사실**을 \`ADVERSE_FACT\` 로 올리십시오.

1. **인정 + 축소**
   - 인정: "~긴 했어요" · "~한 적은 있습니다" · "아 그게" · "~기는 합니다"
   - 곧바로 축소: "근데 그건 ~" · "그냥 ~" · "~일 뿐이에요" · "별거 아니고" · "그건 ~로 친 거고"
   - **축소하는 말은 의뢰인의 평가이지 사실이 아닙니다.** 축소를 걷어내고 앞의 인정만 보십시오.

2. **상대방 주장을 뒷받침하는 진술**
   - 상대방의 주장이 대화에 나오면, **의뢰인의 말 중 그 주장을 뒷받침하는 것을 반드시 찾으십시오.**
   - 상대방이 "투자였다" 고 하는데 의뢰인이 이익 분배 약정을 언급했다면 그것이 불리한 사실입니다.

3. **법적 성질을 바꾸는 사실**
   - 일부 변제(시효 중단·채무 승인) · 기한 유예 · 상계 · 추인 · 이익 분배 약정
   - 화해·합의 언급 · 상대방에게 보낸 문서의 표현

**각 \`ADVERSE_FACT\` 는 \`detail\` 에 의뢰인의 말을 그대로 인용하십시오.**
인용하지 못하면 그것은 추측이므로 올리지 마십시오.
그리고 **왜 불리한지**를 한 줄로 덧붙이십시오 — "상대방의 ~ 주장을 뒷받침함" 형태로.

**각 \`ADVERSE_FACT\` 에는 \`question\` 이 반드시 있어야 합니다.**
불리한 사실을 찾기만 하고 무엇을 물을지 말하지 않으면 변호사가 쓸 수 없습니다.

## 상담 확인 메일 (\`follow_up_draft\`)

변호사가 **의뢰인에게 보낼** 상담 확인 메일 초안입니다. 다음을 담으십시오 —

1. 오늘 확인한 사실관계를 **의뢰인이 읽고 정정할 수 있게** 간추린다
2. **가져오시기로 한 자료**를 목록으로 (\`evidence\` 중 PROMISED 인 것)
3. 다음에 확인할 것 (\`next_questions\`)

**법률 자문이나 승소 가능성을 쓰지 마십시오.** 확인과 요청만 적습니다 —
메일은 의뢰인이 보관하고 나중에 인용할 수 있는 문서입니다.
녹취에 내용이 없으면 **짧게 쓰거나 비워 두십시오.** 지어내지 마십시오.`

/** OpenAI 구조화 출력용 스키마. **모델이 형식을 어길 수 없게 강제한다.** */
export const LEGAL_SCHEMA = {
  name: 'legal_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['case_summary', 'chronological_facts', 'claims', 'legal_elements',
               'risk_and_gaps', 'next_questions', 'follow_up_draft', 'confidence'],
    properties: {
      case_summary: {
        type: 'object', additionalProperties: false,
        required: ['matter_type', 'core_dispute', 'client_position'],
        properties: {
          matter_type: { type: 'string' },
          core_dispute: { type: 'string' },
          client_position: { type: 'string' },
        },
      },
      chronological_facts: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'occurred_on', 'precision', 'fact', 'actors',
                     'legal_meaning', 'source_speakers', 'evidence'],
          properties: {
            id: { type: 'string' },
            occurred_on: { type: 'string' },
            precision: { type: 'string', enum: ['EXACT', 'MONTH', 'YEAR', 'UNKNOWN'] },
            fact: { type: 'string' },
            actors: { type: 'array', items: { type: 'string' } },
            legal_meaning: { type: 'string' },
            source_speakers: { type: 'array', items: { type: 'string' } },
            evidence: {
              type: 'object', additionalProperties: false,
              required: ['kind', 'status', 'holder', 'difficulty'],
              properties: {
                kind: { type: 'string' },
                status: { type: 'string', enum: ['SECURED', 'PROMISED', 'UNCONFIRMED', 'NON_EXISTENT'] },
                holder: { type: 'string' },
                difficulty: { type: 'integer', minimum: 1, maximum: 5 },
              },
            },
          },
        },
      },
      claims: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'claim', 'by', 'supported_by', 'certainty'],
          properties: {
            id: { type: 'string' },
            claim: { type: 'string' },
            by: { type: 'string' },
            supported_by: { type: 'array', items: { type: 'string' } },
            certainty: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      legal_elements: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['cause', 'element', 'status', 'supported_by', 'note'],
          properties: {
            cause: { type: 'string' },
            element: { type: 'string' },
            status: { type: 'string', enum: ['SATISFIED', 'PARTIAL', 'MISSING', 'CONTESTED'] },
            supported_by: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
        },
      },
      risk_and_gaps: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['kind', 'severity', 'detail', 'refs', 'question'],
          properties: {
            kind: { type: 'string', enum: ['GAP', 'INCONSISTENCY', 'ADVERSE_FACT', 'ASSUMPTION'] },
            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            detail: { type: 'string' },
            refs: { type: 'array', items: { type: 'string' } },
            question: { type: 'string' },
          },
        },
      },
      next_questions: { type: 'array', items: { type: 'string' } },
      follow_up_draft: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
} as const

const MODEL = 'gpt-4o'   // 영업 분석(gpt-4o-mini)보다 위다 — 요건 분해는 더 어려운 일이다

export interface LegalAnalysisInput {
  transcript: string
  /** 사건 유형·상대방·사전 메모. 있으면 요건 체크리스트가 훨씬 정확해진다 */
  matterContext?: string
}

/**
 * 상담 녹취를 법률 구조로 분해한다.
 *
 * **실패하면 null 이다.** 부분적으로 채워진 결과를 돌려주지 않는다 —
 * 법률 문서에서 반쯤 맞는 사실관계는 틀린 것보다 위험하다.
 */
export async function analyzeLegalTranscript(
  env: Env, input: LegalAnalysisInput,
): Promise<LegalAnalysis | null> {
  if (!env.OPENAI_API_KEY) return null
  const ctx = input.matterContext ? `\n[사건 정보]\n${input.matterContext}\n` : ''
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_LEGAL_MODEL || MODEL,
        messages: [
          { role: 'system', content: `${LEGAL_PERSONA}\n${LEGAL_GUARDRAILS}` },
          { role: 'user', content: `${ctx}\n[상담 녹취록]\n${input.transcript}` },
        ],
        // 사실관계 분해에서 창의성은 해롭다. 같은 녹취에서 같은 답이 나와야 한다.
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: LEGAL_SCHEMA },
      }),
    })
    if (!r.ok) {
      console.warn(`legal analysis failed: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
      return null
    }
    const d = await r.json<{ choices?: { message?: { content?: string } }[] }>()
    const content = d.choices?.[0]?.message?.content
    return content ? (JSON.parse(content) as LegalAnalysis) : null
  } catch (e) {
    console.error(`legal analysis error: ${e instanceof Error ? e.message : e}`)
    return null
  }
}
