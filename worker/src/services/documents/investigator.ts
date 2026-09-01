/**
 * 수사 서식 — 진술조서 · 피의자신문조서 · 수사보고 (IEP · S6).
 *
 * 근거: 경찰수사규칙 별지 서식 (피의자신문조서 = 별지 제27호).
 *
 * ── 왜 모델을 부르지 않는가 (assemble) ──────────────────────
 *   조서는 **있는 그대로 기록**하는 문서다. 전사·인적사항·고지문을 짜맞출 뿐,
 *   한 문장도 지어내지 않는다. 모델을 부르면 지어낼 여지가 생긴다 — 그래서
 *   `assemble` 만 두고 persona/schema/brief 는 쓰지 않는다 (§0).
 *
 * ── 지어내지 않는다 (§6-D) ──────────────────────────────────
 *   대상자 인적사항은 **사람이 적은 것만** 넣는다. 없으면 빈칸으로 둔다.
 *   화자 역할이 미상이면 라벨을 그대로 둔다 — 「틀린 호칭보다 빈 호칭이 낫다」.
 *
 * 모든 서식은 **초안**이다. 제출 전 수사관이 반드시 확인한다.
 */
import type { DocumentForm, DocContext, Missing } from './types'

/** `2026-09-01` → `2026. 9. 1.` */
function kDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : String(iso)
}

const KIND_KO: Record<string, string> = {
  interrogation: '피의자 신문', witness: '참고인 조사', victim: '피해자 조사',
  interview: '면담', meeting: '회의', general: '일반 조사',
}
const ROLE_KO: Record<string, string> = {
  suspect: '피의자', witness: '참고인', victim: '피해자', bystander: '목격자', attendee: '참석자',
}
const FINDING_KO: Record<string, string> = {
  CONTRADICTION: '진술 간 모순', UNANSWERED: '질문에 대한 미응답',
  UNVERIFIED: '확인이 필요한 주장', ATTITUDE_SHIFT: '진술 태도 변화',
}

/** 오늘 날짜 — 워크플로 밖(라우트)에서 부르므로 new Date 사용 가능. */
function today(): string {
  return kDate(new Date().toISOString().slice(0, 10))
}

/** 연속된 같은 화자의 세그먼트를 한 문단으로 잇는다 — 조각난 조서를 읽기 좋게. */
function mergeTurns(t: DocContext['transcript']): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = []
  for (const seg of t) {
    const text = seg.content.trim()
    if (!text) continue
    const last = out[out.length - 1]
    if (last && last.label === seg.speakerLabel) last.text += ' ' + text
    else out.push({ label: seg.speakerLabel, text })
  }
  return out
}

/** 화자 라벨을 문답 표기로. 수사관→문, 대상자류→답, 그 외→라벨 그대로(미상 존중). */
function qaPrefix(label: string): string {
  if (label.includes('수사관')) return '문'
  if (/대상자|피의자|참고인|피해자|목격자/.test(label)) return '답'
  return label   // 「화자 A」·「미상」 은 그대로 — 틀린 호칭보다 빈 호칭이 낫다
}

/** 조서의 문답 본문. */
function renderQA(ctx: DocContext): string[] {
  const turns = mergeTurns(ctx.transcript)
  if (!turns.length) return ['(전사 내용이 없습니다)']
  const lines: string[] = []
  for (const t of turns) {
    const p = qaPrefix(t.label)
    // 문/답 이면 「문: …」, 라벨 그대로면 「[미상] …」
    lines.push(p === '문' || p === '답' ? `${p}   ${t.text}` : `[${t.label}]   ${t.text}`)
  }
  return lines
}

/** 대상자 인적사항 칸 — 사람이 적은 것만, 없으면 빈칸. */
function subjectHeader(ctx: DocContext, roleHint?: string): string[] {
  const s = ctx.subjects.find((x) => (roleHint ? x.role === roleHint : true))
  const name = s?.displayName ?? ''
  return [
    `성    명:  ${name}`,
    '주민등록번호:',
    '직    업:',
    '주    거:',
    '등록기준지:',
    '연 락 처:',
  ]
}

/** 작성자(수사관) 블록 — 프로필에서. */
function authorBlock(ctx: DocContext): string[] {
  const a = ctx.author
  const belong = a?.firmName?.trim() || '(소속 미기재)'
  const who = [a?.position?.trim(), a?.name?.trim()].filter(Boolean).join(' ') || '(작성자 미기재)'
  return [belong, `사법경찰관 ${who}          (인)`]
}

const REVIEW_LINE = '※ 이 문서는 전사 기반 **초안**입니다. 제출 전 대상자 확인·인적사항 기입·문답 정리를 반드시 하십시오.'

/** assemble 만 쓰는 서식을 위해 안 쓰는 필드를 채워 준다. */
function templateForm(spec: {
  kind: string; label: string; description: string
  missing: (ctx: DocContext) => Missing[]
  title: (ctx: DocContext) => string
  assemble: (ctx: DocContext) => { title: string; body: string; result: Record<string, unknown> }
}): DocumentForm {
  return {
    kind: spec.kind, label: spec.label, description: spec.description,
    missing: spec.missing, title: spec.title, assemble: spec.assemble,
    // 아래는 assemble 이 있으면 호출되지 않는다 (generate.ts).
    persona: '', schema: {}, brief: () => '',
    render: (_r, ctx) => spec.assemble(ctx).body,
  }
}

/** 조사가 선택되지 않았으면 수사 서식은 만들 수 없다 — 조사 중심 문서다. */
function needMeeting(ctx: DocContext): Missing[] {
  if (!ctx.meeting) return [{ msg: '조사를 선택해 만드십시오 — 조서·보고는 조사 단위 문서입니다' }]
  return []
}
function needTranscript(ctx: DocContext): Missing[] {
  if (!ctx.transcript.length) return [{ msg: '전사 내용이 없습니다 — 녹음·분석을 먼저 하십시오' }]
  return []
}

// ── 진술조서 (참고인·피해자·목격자·면담) ─────────────────────
export const statementRecord = templateForm({
  kind: 'statement_record',
  label: '진술조서',
  description: '조사에서 나온 진술을 문답 형식으로 정리한 초안입니다',
  missing(ctx) {
    const m = needMeeting(ctx); if (m.length) return m
    return needTranscript(ctx)
  },
  title: (ctx) => `${ctx.meeting?.title ?? '조사'} — 진술조서`,
  assemble(ctx) {
    const L: string[] = []
    L.push('진 술 조 서', '')
    L.push(...subjectHeader(ctx), '')
    const place = ctx.meeting?.notes?.trim() ? ` ${ctx.meeting.notes.trim()}에서` : ''
    L.push(`위의 사람은 ${ctx.meeting?.title ?? '본건'} 사건에 관하여 `
      + `${kDate(ctx.meeting?.occurredAt)}${place} 다음과 같이 진술하다.`, '')
    L.push('[진술 내용]', '')
    L.push(...renderQA(ctx), '')
    L.push('위 조서를 진술자에게 열람하게 한 후 진술한 대로 오기나 증감·변경할 것이 '
      + '없다고 하므로 서명(기명)날인하게 하다.', '')
    L.push('진술자                              (서명)', '')
    L.push(today(), '')
    L.push(...authorBlock(ctx), '')
    L.push('─'.repeat(52), REVIEW_LINE)
    return { title: `${ctx.meeting?.title ?? '조사'} — 진술조서`,
             body: L.join('\n'), result: { kind: 'statement_record' } }
  },
})

// ── 피의자신문조서 (피의자 · interrogation) ──────────────────
const RIGHTS = [
  '1. 귀하는 일체의 진술을 하지 아니하거나 개개의 질문에 대하여 진술을 거부할 수 있습니다.',
  '2. 귀하가 진술을 하지 아니하더라도 불이익을 받지 아니합니다.',
  '3. 귀하가 진술을 거부할 권리를 포기하고 행한 진술은 법정에서 유죄의 증거로 사용될 수 있습니다.',
  '4. 귀하가 신문을 받을 때에는 변호인을 참여하게 하는 등 변호인의 조력을 받을 수 있습니다.',
]
export const suspectRecord = templateForm({
  kind: 'suspect_record',
  label: '피의자신문조서',
  description: '피의자 신문 진술을 문답으로 정리한 초안입니다 (진술거부권·변호인조력권 고지 포함)',
  missing(ctx) {
    const m = needMeeting(ctx); if (m.length) return m
    if (ctx.meeting?.kind !== 'interrogation') {
      return [{ msg: '피의자 신문(interrogation) 조사에서만 만듭니다 — '
        + '참고인·피해자는 진술조서를 쓰십시오' }]
    }
    return needTranscript(ctx)
  },
  title: (ctx) => `${ctx.meeting?.title ?? '조사'} — 피의자신문조서`,
  assemble(ctx) {
    const L: string[] = []
    L.push('피의자신문조서', '')
    L.push(...subjectHeader(ctx, 'suspect'), '')
    L.push(`위의 사람에 대한 ${ctx.meeting?.title ?? '본건'} 피의사건에 관하여 `
      + `${kDate(ctx.meeting?.occurredAt)} 다음과 같이 신문하다.`, '')
    L.push('', '[진술거부권 및 변호인 조력권의 고지]', '')
    L.push('사법경찰관은 피의자에게 다음과 같이 알려주다.', '')
    L.push(...RIGHTS, '')
    L.push('문   이상의 권리가 있음을 고지받았는가요.', '답   ', '')
    L.push('문   진술을 거부할 권리를 행사할 것인가요.', '답   ', '')
    L.push('문   변호인의 조력을 받을 것인가요.', '답   ', '')
    L.push('', '[신문 내용]', '')
    L.push(...renderQA(ctx), '')
    L.push('', '위 조서를 진술자에게 열람하게 한 후 진술한 대로 오기나 증감·변경할 것이 '
      + '없다고 하므로 서명(기명)날인하게 하다.', '')
    L.push('진술자                              (서명)', '')
    L.push(today(), '')
    L.push(...authorBlock(ctx), '')
    L.push('─'.repeat(52), REVIEW_LINE)
    return { title: `${ctx.meeting?.title ?? '조사'} — 피의자신문조서`,
             body: L.join('\n'), result: { kind: 'suspect_record' } }
  },
})

// ── 수사보고 (수사관 자체 보고 · 진술 분석 요지) ─────────────
export const investigationReport = templateForm({
  kind: 'investigation_report',
  label: '수사보고',
  description: '조사 요지와 진술 분석(모순·미확인·태도변화)을 수사관 관점으로 정리합니다',
  missing(ctx) {
    const m = needMeeting(ctx); if (m.length) return m
    if (!ctx.analysis?.summary && !ctx.transcript.length) {
      return [{ msg: '분석 결과도 전사도 없습니다 — 조사를 먼저 분석하십시오' }]
    }
    return []
  },
  title: (ctx) => `${ctx.meeting?.title ?? '조사'} — 수사보고`,
  assemble(ctx) {
    const L: string[] = []
    L.push('수 사 보 고', '')
    L.push(`사건명: ${ctx.meeting?.title ?? ''}`)
    L.push(`작성일: ${today()}`, '')

    L.push('1. 조사 개요')
    L.push(`   - 조사 종류: ${KIND_KO[ctx.meeting?.kind ?? ''] ?? ctx.meeting?.kind ?? ''}`)
    L.push(`   - 조사 일시: ${kDate(ctx.meeting?.occurredAt) || '미기재'}`)
    const subj = ctx.subjects.length
      ? ctx.subjects.map((s) => `${ROLE_KO[s.role] ?? s.role}${s.displayName ? `(${s.displayName})` : ''}`).join(', ')
      : '미기재'
    L.push(`   - 대상자: ${subj}`, '')

    L.push('2. 진술 요지')
    L.push(`   ${ctx.analysis?.summary?.trim() || '(요지 없음)'}`, '')

    if (ctx.analysis?.keyPoints.length) {
      L.push('3. 주요 진술')
      for (const k of ctx.analysis.keyPoints) L.push(`   - ${k}`)
      L.push('')
    }

    // 4. 확인이 필요한 사항 — **판정이 아니라 짚기.** 인용을 함께 붙인다 (§0).
    L.push('4. 확인이 필요한 사항 (진술 분석)')
    if (!ctx.findings.length) {
      L.push('   - 없음')
    } else {
      ctx.findings.forEach((f, i) => {
        L.push(`   ${i + 1}) [${FINDING_KO[f.kind] ?? f.kind}] ${f.detail}`)
        for (const q of f.refs) L.push(`        · 인용: "${q}"`)
        if (f.question) L.push(`        · 확인 질문: ${f.question}`)
      })
    }
    L.push('   ※ 위는 판정이 아니라 확인해 볼 지점입니다. 판단은 수사관이 합니다.', '')

    const checks = ctx.analysis?.actionItems ?? []
    if (checks.length) {
      L.push('5. 다음 조사에서 확인할 사항')
      for (const c of checks) L.push(`   - ${c}`)
      L.push('')
    }

    L.push('작성자', ...authorBlock(ctx).map((x) => `   ${x}`), '')
    L.push('─'.repeat(52), REVIEW_LINE)
    return { title: `${ctx.meeting?.title ?? '조사'} — 수사보고`,
             body: L.join('\n'), result: { kind: 'investigation_report' } }
  },
})
