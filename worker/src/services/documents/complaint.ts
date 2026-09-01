/**
 * 소장(訴狀).
 *
 * 근거: `docs/Complaint_template.md`
 *
 * ── 무엇을 모델에게 맡기고 무엇을 안 맡기는가 ────────────────
 *
 * **맡긴다** — 청구원인 단락의 문장. 요건사실과 시계열을 법률 문장으로 엮는 일이다.
 * **안 맡긴다** — 당사자 이름·주소, 금액, 인지액·송달료, 법원 이름, 날짜.
 *   이것들은 우리가 가진 값을 `render()` 에서 **그대로 박아 넣는다.**
 *   모델이 「금 10,000,000원」 을 「금 1,000만원」 으로 바꿔 써도 소장에서는 사고다.
 *
 * ── 불리한 사실은 소장에 쓰지 않는다 ─────────────────────────
 *
 * `findings` 의 `ADVERSE_FACT` 는 **변호사가 알아야 할 것**이지 상대에게 알릴 것이 아니다.
 * 모델에게 넘기되 「소장 본문에 쓰지 말고, 그것을 피해 가는 방식으로 구성하라」 고 지시하고,
 * 화면에는 **따로** 경고로 보여 준다.
 */
import type { DocumentForm, DocContext, Missing } from './types'
import { calcCosts, SERVICE_ROUNDS } from './costs'

const won = (n: number) => n.toLocaleString('ko-KR')

/** `2023-03-12` → `2023. 3. 12.` — 서면의 날짜 표기다. */
function courtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(iso)
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`
}

export const complaint: DocumentForm = {
  kind: 'complaint',
  label: '소장',
  description: '요건사실·시계열·증거로 청구취지와 청구원인을 엮습니다',

  params: [
    { name: 'claimAmount', label: '소가 (청구 원금)', type: 'number', required: true,
      hint: '원 단위. 인지액·송달료가 이 값으로 계산됩니다' },
    { name: 'court', label: '관할 법원', type: 'text', required: true,
      hint: '예: 서울중앙지방법원' },
    { name: 'scale', label: '사건 규모', type: 'select', options: Object.keys(SERVICE_ROUNDS),
      hint: '송달 회수가 달라집니다 (소액 10회 · 단독 15회)' },
    { name: 'electronic', label: '전자소송으로 제출', type: 'boolean',
      hint: '인지액 10% 감액' },
    { name: 'interestStartDate', label: '지연손해금 기산일', type: 'date',
      hint: '비우면 청구취지에서 빠집니다' },
    /**
     * **불리한 사실을 어떻게 다룰지는 소송 전략이다 — 도구가 정하지 않는다.**
     * 기본값이 「선제 규정」 인 이유: 상대는 그 사실을 이미 갖고 있고,
     * 우리가 안 쓰면 상대가 자기 언어로 먼저 꺼내 **프레임을 상대가 잡는다.**
     */
    /**
     * **변호사가 직접 적는 칸.**
     *
     * 자료는 상담에서 나온 것이라 늘 부족하다 — 당사자 주소, 계약서 유무,
     * 상대의 예상 항변처럼 **변호사만 아는 것**이 있다.
     * 그것을 넣을 자리가 없으면 변호사는 나온 소장을 통째로 고쳐 쓰게 되고,
     * 그러면 이 기능을 안 쓴다.
     *
     * 이 칸은 **자료보다 우선한다** — 페르소나에 그렇게 적혀 있다.
     */
    { name: 'supplement', label: '변호사가 보태는 것', type: 'text',
      hint: '자료에 없거나 자료가 틀린 것을 적으십시오. 여기 적은 것이 자료보다 우선합니다' },
    { name: 'adverseHandling', label: '불리한 사실 처리', type: 'select',
      options: ['선제 규정', '언급하지 않음'],
      hint: '선제 규정 — 사실은 적되 성격은 우리가 붙인다 (권장) · 언급하지 않음 — 소장에서 뺀다' },
  ],

  missing(ctx) {
    const out: Missing[] = []
    if (!ctx.client?.name) out.push({ msg: '원고(의뢰인)가 사건에 연결되어 있지 않습니다', fix: 'client' })
    // **지운 의뢰인으로 소장을 쓰지 않는다.** 소프트 삭제라 이름은 그대로 나와서,
    // 「지웠다」 고 생각한 사람이 법원 문서에 원고로 찍힌다. 다시 고르게 한다.
    else if (ctx.client.deleted) {
      out.push({ msg: `원고 「${ctx.client.name}」 는 지운 의뢰인입니다 — 다시 고르십시오`,
                 fix: 'client' })
    }
    if (!ctx.adverseParties.length) out.push({ msg: '피고(상대방)가 없습니다', fix: 'adverseParty' })
    if (!ctx.matter.cause) out.push({ msg: '청구원인이 정해지지 않았습니다', fix: 'cause' })
    if (!Number(ctx.params.claimAmount)) out.push({ msg: '소가를 입력하십시오', param: 'claimAmount' })
    if (!String(ctx.params.court || '').trim()) out.push({ msg: '관할 법원을 입력하십시오', param: 'court' })
    // **요건이 하나도 안 채워졌으면 쓸 것이 없다.** 상담을 먼저 해야 한다.
    if (!ctx.elements.some((e) => e.status !== 'MISSING')) {
      out.push({ msg: '확인된 요건사실이 하나도 없습니다 — 상담을 분석하거나 요건을 직접 정하십시오' })
    }
    // **요건이 「충족」 이어도 그것을 받쳐 줄 사실이 없으면 청구원인을 쓸 수 없다.**
    // 요건은 사람이 손으로 「충족」 으로 바꿔 놓을 수 있어서(025) 통과해 버린다.
    // 그 상태로 뽑으면 날짜도 금액도 없는 빈 단락이 나온다 —
    // 2026-08-26 에 상담을 사건에서 뗀 뒤에도 「만들 수 있음」 으로 나오던 것이 이것이다.
    // 변호사가 직접 적어 넣었으면 그것으로 갈음한다. 자료보다 그쪽이 위다.
    if (!ctx.timeline.length && !String(ctx.params.supplement || '').trim()) {
      out.push({
        msg: '사건에 시계열 사실이 하나도 없습니다 — 상담을 이 사건에 연결하거나, '
           + '아래 「변호사가 보태는 것」 에 사실관계를 직접 적으십시오',
        param: 'supplement',
      })
    }
    return out
  },

  title: (ctx) => `${ctx.matter.title} — 소장`,

  persona: `당신은 대한민국 민사소송 실무에 밝은 변호사입니다.
아래 사건 자료로 **소장의 청구원인 단락**을 작성합니다.

## 반드시 지킬 것

0. **「변호사가 직접 적은 것」 이 있으면 그것이 다른 모든 자료보다 우선합니다.**
   자료와 어긋나면 **변호사 쪽을 따르십시오.** 상담 기록은 불완전하고,
   변호사는 자료에 없는 것(당사자 주소·계약서 유무·상대의 예상 항변)을 압니다.
   다만 변호사가 안 적은 것을 그 사람 뜻이라고 넘겨짚지는 마십시오.
1. **자료에 없는 사실을 쓰지 마십시오.** 날짜·금액·이름이 자료에 없으면
   그 단락을 짧게 쓰거나 비우십시오. 채워 넣기 위해 지어내면 안 됩니다.
2. **금액과 날짜를 문장 안에서 바꾸지 마십시오.** 자료에 적힌 그대로 인용합니다.
3. **불리한 사실은 「감추라」 는 뜻이 아닙니다. 우리 언어로 먼저 규정하십시오.**

   상대는 그 사실을 **이미 알고 있습니다**(대개 상대가 만든 기록입니다).
   우리가 안 쓰면 상대가 답변서에서 자기 언어로 먼저 꺼내고, **프레임을 상대가 잡습니다.**

   - **상대의 규정(성격 부여)을 절대 인용하지 마십시오.**
     실측 사고 (2026-08-26): 자료에 「500만원을 **이자 명목으로** 반환함」 이라고 적혀 있었는데
     그대로 옮겨 적었습니다. 소장에 「이자」 라고 쓰면 **소비대차·투자 관계를 우리가 인정하는 꼴**입니다.
   - **행위는 적되 성격은 우리가 붙이십시오.**
     「피고가 500만원을 지급하였는바, **이는 부당이득 원금의 일부 반환에 해당합니다**」
   - \`evidenceList\` 의 \`proves\` 도 같습니다. 「이자 지급 사실」 이 아니라 「500만원 지급 사실」.

4. 날짜가 \`MONTH\`·\`YEAR\` 정밀도이면 「2023. 8.경」 처럼 **경(頃)** 을 붙이십시오.
   모르는 날을 아는 척하지 않습니다.
5. 문체는 서면체입니다. 「~합니다」 체를 쓰고 감정적 표현을 넣지 않습니다.
6. **청구액과 자료가 어긋나면 \`cautions\` 에 반드시 적으십시오.**
   일부 변제·상계·기수령액이 있는데 소가가 그대로면 청구액을 다시 볼 일입니다.
   본문에서 임의로 금액을 깎지 말고 **변호사에게 물으십시오.**

## 단락 구성

\`sections\` 에 순서대로 담으십시오. 각 단락은 소제목과 본문입니다.
전형적인 순서는 다음과 같으나, **사건에 맞게 조정하십시오** —

- \`RELATIONSHIP\`  당사자들의 관계
- \`CONTRACT\`      계약의 체결 / 급부의 이행
- \`BREACH\`        채무불이행 또는 법률상 원인의 부존재
- \`DAMAGES\`       손해의 발생과 범위
- \`CONCLUSION\`    결론

## 청구취지

\`claimIntent\` 는 청구취지 본문입니다. **금액과 이율은 [소가]·[기산일] 자리표시자로 두십시오** —
실제 숫자는 시스템이 넣습니다. 예:

  1. 피고는 원고에게 [소가]원 및 이에 대하여 [기산일]부터 이 사건 소장 부본 송달일까지는
     연 5%, 그 다음 날부터 다 갚는 날까지는 연 12%의 각 비율로 계산한 돈을 지급하라.
  2. 소송비용은 피고가 부담한다.
  3. 제1항은 가집행할 수 있다.

## 함께 낼 것

\`cautions\` — **변호사가 제출 전에 확인해야 할 것**을 적으십시오.
불리한 사실, 빠진 증거, 시효 문제 등. 이것은 소장 본문이 아니라 우리 쪽 메모입니다.

\`strategies\` — **불리한 사실을 어떻게 다룰지에 선택지가 있으면** 적으십시오.
소송 전략은 **변호사가 정할 일**이므로, 당신은 고르지 말고 **꺼내 놓기만** 하십시오.
각 선택지에 얻는 것과 잃는 것을 함께 적습니다. 예 —

  approach  「500만원을 원금 일부 반환으로 규정하고 4,500만원을 청구」
  gains     「이자로 규정되는 것을 막고 청구액 모순이 없어짐」
  costs     「500만원의 성격에 대한 다툼을 포기」

선택지가 없으면 빈 배열로 두십시오. **억지로 만들지 마십시오.**`,

  schema: {
    name: 'complaint_draft',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentTitle', 'claimIntent', 'sections', 'evidenceList', 'cautions', 'strategies'],
      properties: {
        documentTitle: { type: 'string', description: '예: 대여금 청구의 소' },
        claimIntent: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['sequence', 'sectionType', 'title', 'content'],
            properties: {
              sequence: { type: 'integer' },
              sectionType: {
                type: 'string',
                enum: ['RELATIONSHIP', 'CONTRACT', 'BREACH', 'DAMAGES', 'CONCLUSION', 'OTHER'],
              },
              title: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
        evidenceList: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['number', 'title', 'proves'],
            properties: {
              number: { type: 'integer', description: '갑 제N호증' },
              title: { type: 'string' },
              proves: { type: 'string' },
            },
          },
        },
        cautions: { type: 'array', items: { type: 'string' } },
        /** 불리한 사실을 다루는 갈림길. **모델이 고르지 않는다** — 변호사가 고른다. */
        strategies: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['approach', 'gains', 'costs'],
            properties: {
              approach: { type: 'string' },
              gains: { type: 'string' },
              costs: { type: 'string' },
            },
          },
        },
      },
    },
  },

  brief(ctx) {
    const L = (t: string, s: string) => (s.trim() ? `\n## ${t}\n${s}` : '')
    return [
      `사건: ${ctx.matter.title}`,
      ctx.matter.cause ? `청구원인: ${ctx.matter.cause}` : '',
      `원고: ${ctx.client?.name ?? '(미지정)'}`,
      `피고: ${ctx.adverseParties.map((p) => p.name).join(', ') || '(미지정)'}`,
      `소가: ${won(Number(ctx.params.claimAmount) || 0)}원`,
      ctx.params.interestStartDate ? `지연손해금 기산일: ${courtDate(String(ctx.params.interestStartDate))}` : '',
      L('요건사실 (확인 상태)',
        ctx.elements.map((e) => `- ${e.element} [${e.status}]${e.note ? ` — ${e.note}` : ''}`).join('\n')),
      L('시계열',
        ctx.timeline.map((t) => `- ${t.occurredOn ?? '날짜 불명'} (${t.precision ?? 'UNKNOWN'}) ${t.what}`
          + (t.legalMeaning ? ` [${t.legalMeaning}]` : '')).join('\n')),
      L('증거',
        ctx.evidence.map((e) => `- ${e.kind}: ${e.what} [${e.status}]`
          + (e.proves ? ` — ${e.proves}` : '')).join('\n')),
      L(ctx.params.adverseHandling === '언급하지 않음'
          ? '**소장에서 빼야 할 것 (변호사가 「언급하지 않음」 을 골랐습니다)**'
          : '**불리한 사실 — 우리 언어로 먼저 규정할 것 (상대의 성격 부여를 인용하지 마십시오)**',
        ctx.findings.map((f) => `- [${f.kind}/${f.severity}] ${f.detail}`).join('\n')),
      String(ctx.params.supplement || '').trim()
        ? `\n## **변호사가 직접 적은 것 — 아래가 위 자료보다 우선합니다**\n${String(ctx.params.supplement).trim()}`
        : '',
      ctx.params.adverseHandling === '언급하지 않음'
        ? '\n※ 변호사가 「언급하지 않음」 을 골랐습니다. 위 사실을 소장 어디에도 쓰지 마십시오.'
          + ' 다만 그것이 상대의 항변이 될 것을 전제하고 사실관계를 구성하고, `cautions` 에 그 위험을 적으십시오.'
        : '\n※ 변호사가 「선제 규정」 을 골랐습니다. 위 사실을 **행위만** 적고 성격은 우리가 붙이십시오.',
    ].filter(Boolean).join('\n')
  },

  render(result, ctx) {
    const r = result as {
      documentTitle?: string; claimIntent?: string
      sections?: Array<{ sequence: number; title: string; content: string }>
      evidenceList?: Array<{ number: number; title: string; proves: string }>
      cautions?: string[]
    }
    const amount = Number(ctx.params.claimAmount) || 0
    const costs = calcCosts({
      claimAmount: amount,
      partyCount: 1 + ctx.adverseParties.length,
      scale: ctx.params.scale as never,
      electronic: !!ctx.params.electronic,
    })

    // **자리표시자를 우리 값으로 바꾼다.** 모델이 쓴 숫자를 그대로 두지 않는다.
    const intent = String(r.claimIntent ?? '')
      .replace(/\[소가\]/g, won(amount))
      .replace(/\[기산일\]/g, courtDate(ctx.params.interestStartDate as string) || '(기산일 미정)')

    const A = ctx.author
    const authorLine = A
      ? [A.firmName, A.name && A.position ? `${A.name} ${A.position}` : A.name,
         A.barNo ? `변호사등록번호 ${A.barNo}` : '', A.officePhone].filter(Boolean).join(' · ')
      : ''

    const lines: string[] = []
    lines.push('소     장', '')
    lines.push(`사건명  ${r.documentTitle || ctx.matter.title}`, '')
    lines.push(`원  고  ${ctx.client?.name ?? '(미지정)'}`)
    for (const p of ctx.adverseParties) lines.push(`피  고  ${p.name}`)
    lines.push('')
    lines.push('청 구 취 지', '')
    lines.push(intent || '(청구취지가 생성되지 않았습니다)', '')
    lines.push('청 구 원 인', '')
    for (const s of (r.sections ?? []).sort((a, b) => a.sequence - b.sequence)) {
      lines.push(`${s.sequence}. ${s.title}`, '', s.content, '')
    }
    if (r.evidenceList?.length) {
      lines.push('입 증 방 법', '')
      for (const e of r.evidenceList) {
        lines.push(`갑 제${e.number}호증   ${e.title}${e.proves ? `   (${e.proves})` : ''}`)
      }
      lines.push('')
    }
    lines.push('첨 부 서 류', '', '1. 위 입증방법   각 1통', '2. 소장 부본   1통', '')
    lines.push(`${courtDate(new Date().toISOString().slice(0, 10))}`, '')
    lines.push(`원고 소송대리인  ${authorLine || '(프로필을 채우면 여기 들어갑니다)'}`, '')
    lines.push(`${String(ctx.params.court || ctx.matter.court || '(법원 미지정)')} 귀중`, '')

    lines.push('─'.repeat(52))
    lines.push('※ 아래는 서면에 들어가지 않는 확인용 메모입니다.', '')
    lines.push('[소송비용 (초안 계산)]')
    lines.push(`  소가        ${won(costs.claimAmount)}원`)
    lines.push(`  인지액      ${costs.stampFee != null ? `${won(costs.stampFee)}원` : '계산 불가'}`)
    lines.push(`  송달료      ${costs.serviceFee != null ? `${won(costs.serviceFee)}원` : '계산 불가'}`)
    lines.push(`  합계        ${costs.totalCost != null ? `${won(costs.totalCost)}원` : '계산 불가'}`)
    for (const n of costs.notes) lines.push(`  · ${n}`)
    if (r.cautions?.length) {
      lines.push('', '[제출 전에 확인할 것]')
      for (const c of r.cautions) lines.push(`  · ${c}`)
    }
    const strat = (r as { strategies?: Array<{ approach: string; gains: string; costs: string }> }).strategies
    if (strat?.length) {
      lines.push('', '[갈림길 — **변호사가 고를 일입니다.** 도구는 꺼내 놓기만 합니다]')
      strat.forEach((x, i) => {
        lines.push(`  ${i + 1}) ${x.approach}`)
        lines.push(`     얻는 것: ${x.gains}`)
        lines.push(`     잃는 것: ${x.costs}`)
      })
    }
    if (ctx.findings.length) {
      const how = ctx.params.adverseHandling === '언급하지 않음'
        ? '소장에서 뺐습니다'
        : '소장에는 행위만 적고 성격은 우리 쪽으로 규정했습니다'
      lines.push('', `[상담에서 나온 불리한 사실 — ${how}]`)
      for (const f of ctx.findings) lines.push(`  · [${f.kind}] ${f.detail}`)
    }
    return lines.join('\n')
  },
}
