/**
 * 사건 자료를 모아 서식에 넘기고, 결과를 남긴다 (029).
 *
 * **서식을 모른다.** 여기 있는 것은 어느 서식에나 같은 일뿐이다 —
 * 모으고 · 부족한지 보고 · 부르고 · 박제한다. 서식별 차이는 전부 `documents/<서식>.ts` 에 있다.
 */
import type pg from 'pg'
import type { Env } from '../../lib/env'
import { logLine } from '../../lib/log'
import { maskPii } from '../../lib/pii'
import { getForm } from './index'
import type { DocContext, Missing } from './types'

/** 페르소나를 고치면 이 값을 올린다. 전후를 비교하려면 어느 판으로 뽑았는지 알아야 한다. */
// .2 — 불리한 사실이 `proves` 로 새던 것을 막고, 청구액 불일치를 cautions 로 올리게 함
// .3 — 「감추기」 를 「선제 규정」 으로 바꾸고, 전략 갈림길을 변호사에게 꺼내 놓게 함
// .4 — 「변호사가 직접 적은 것」 을 모든 자료보다 위에 둠
export const DOC_PERSONA_REV = '2026-08-26.4'

/**
 * 사건 하나를 서식이 볼 수 있는 모양으로 모은다.
 *
 * **상담(meeting)은 선택이다.** 사건 화면에서 바로 만들 수도 있고,
 * 특정 상담에서 만들 수도 있다 — 후자면 그 상담의 `findings` 만 본다.
 */
export async function gather(
  db: pg.Client, matterId: string, opts: { meetingId?: string | null; params?: Record<string, unknown> },
): Promise<DocContext | null> {
  const m = (await db.query(
    // **지운 의뢰인인지도 가져온다.** 소프트 삭제라 행은 남아 있어서,
    // 목록에서 사라진 사람이 소장의 원고로 그대로 찍히던 일이 있었다 (2026-08-26 검증).
    `select m.id, m.title, m.cause, m.matter_type, m.court, m.file_no, m.notes,
            m.user_id, c.id as client_id, c.company_name as client_name,
            (c.deleted_at is not null) as client_deleted
       from v2.matters m left join v2.customers c on c.id = m.client_id
      where m.id = $1`, [matterId])).rows[0]
  if (!m) return null

  const [adv, el, tl, ev, fi, la, au] = await Promise.all([
    db.query('select name, role, note from v2.adverse_parties where matter_id = $1 order by name', [matterId]),
    db.query(`select element, status, note from v2.legal_elements
               where matter_id = $1 order by sort_order, element`, [matterId]),
    db.query(`select occurred_on, precision, what, legal_meaning
                from v2.timeline_events where matter_id = $1 order by occurred_on nulls last`, [matterId]),
    db.query(`select kind, what, status, holder, proves
                from v2.evidence where matter_id = $1 order by status, kind`, [matterId]),
    // 상담을 지정했으면 그 상담 것만. 아니면 사건 전체.
    opts.meetingId
      ? db.query(`select kind, severity, detail, question, refs from v2.findings
                   where meeting_id = $1 order by created_at`, [opts.meetingId])
      : db.query(`select kind, severity, detail, question, refs from v2.findings
                   where matter_id = $1 order by created_at limit 40`, [matterId]),
    opts.meetingId
      ? db.query('select result from v2.legal_analyses where meeting_id = $1', [opts.meetingId])
      : Promise.resolve({ rows: [] as Array<{ result: unknown }> }),
    db.query(`select name, bar_no, firm_name, position, office_phone, office_address
                from v2.users where id = $1`, [m.user_id]),
  ])

  const a = au.rows[0]

  // ── 조사(meeting) 자료 — 수사 서식(조서·수사보고)이 쓴다. meetingId 없으면 전부 빈다.
  let meeting: DocContext['meeting'] = null
  let transcript: DocContext['transcript'] = []
  let subjects: DocContext['subjects'] = []
  let analysis: DocContext['analysis'] = null
  let images: DocContext['images'] = []
  if (opts.meetingId) {
    const [mm, ts, sp, ar, im] = await Promise.all([
      db.query(`select id, title, kind, start_time, created_at, notes
                  from v2.meetings where id = $1`, [opts.meetingId]),
      db.query(`select speaker_label, content from v2.transcript_segments
                 where meeting_id = $1 order by sort_order`, [opts.meetingId]),
      db.query(`select role, display_name, speaker_label from v2.subject_parties
                 where meeting_id = $1 order by created_at`, [opts.meetingId]),
      db.query(`select summary, key_points, action_items from v2.analysis_results
                 where meeting_id = $1`, [opts.meetingId]),
      db.query(`select reason, sha256, description, captured_at from v2.meeting_images
                 where meeting_id = $1 order by created_at`, [opts.meetingId]),
    ])
    const mr = mm.rows[0]
    if (mr) {
      // **날짜는 ISO 로 만든다.** pg 가 timestamptz 를 Date 객체로 주면
      // String() 은 「Tue Sep 01 2026…」 이 되어 slice(0,10)=「Tue Sep 01」 이 된다.
      const rawDate = mr.start_time ?? mr.created_at
      meeting = {
        id: mr.id, title: mr.title, kind: mr.kind,
        occurredAt: rawDate ? new Date(rawDate as string).toISOString().slice(0, 10) : null,
        notes: mr.notes ?? null,
      }
    }
    transcript = ts.rows.map((t: Record<string, unknown>) => ({
      speakerLabel: String(t.speaker_label ?? ''), content: String(t.content ?? ''),
    }))
    subjects = sp.rows.map((r: Record<string, unknown>) => ({
      role: String(r.role), displayName: (r.display_name as string) ?? null,
      speakerLabel: (r.speaker_label as string) ?? null,
    }))
    const arr = ar.rows[0]
    if (arr) {
      analysis = {
        summary: arr.summary ?? null,
        keyPoints: Array.isArray(arr.key_points) ? arr.key_points.map(String) : [],
        actionItems: Array.isArray(arr.action_items) ? arr.action_items.map(String) : [],
      }
    }
    images = im.rows.map((r: Record<string, unknown>) => {
      const d = r.description as { summary?: string } | null
      return {
        reason: String(r.reason ?? ''), sha256: String(r.sha256 ?? ''),
        summary: d?.summary ?? null,
        capturedAt: r.captured_at ? String(r.captured_at).slice(0, 10) : null,
      }
    })
  }

  return {
    matter: {
      id: m.id, title: m.title, cause: m.cause, matterType: m.matter_type,
      court: m.court, fileNo: m.file_no, notes: m.notes,
    },
    client: m.client_id
      ? { id: m.client_id, name: m.client_name, deleted: !!m.client_deleted }
      : null,
    adverseParties: adv.rows,
    elements: el.rows,
    timeline: tl.rows.map((t: Record<string, unknown>) => ({
      occurredOn: t.occurred_on ? String(t.occurred_on).slice(0, 10) : null,
      precision: t.precision as string | null,
      what: t.what as string,
      legalMeaning: t.legal_meaning as string | null,
    })),
    evidence: ev.rows,
    findings: fi.rows.map((f: Record<string, unknown>) => ({
      kind: String(f.kind), severity: String(f.severity ?? 'MEDIUM'),
      detail: String(f.detail ?? ''), question: (f.question as string) ?? null,
      refs: Array.isArray(f.refs) ? (f.refs as unknown[]).map(String) : [],
    })),
    legal: (la.rows[0]?.result as Record<string, unknown>) ?? null,
    author: a ? {
      name: a.name, barNo: a.bar_no, firmName: a.firm_name,
      position: a.position, officePhone: a.office_phone, officeAddress: a.office_address,
    } : null,
    meeting, transcript, subjects, analysis, images,
    params: opts.params ?? {},
  }
}

export interface GenerateResult {
  ok: true
  kind: string; title: string
  result: Record<string, unknown>
  body: string
  model: string
}
export interface GenerateBlocked { ok: false; missing: Missing[] }

export async function generateDocument(
  env: Env, ctx: DocContext, kind: string,
): Promise<GenerateResult | GenerateBlocked> {
  const form = getForm(kind)
  if (!form) return { ok: false, missing: [{ msg: `알 수 없는 서식입니다: ${kind}` }] }

  // **재료가 없으면 부르지 않는다.** 모델이 빈자리를 지어내는 것을 막는 유일한 방법이다.
  const missing = form.missing(ctx)
  // **문구만 넘기면 화면이 고칠 칸을 못 띄운다.** 통째로 넘긴다.
  if (missing.length) return { ok: false, missing }

  // **조립형 서식(조서·수사보고)은 모델을 부르지 않는다.** 있는 그대로 짜맞춘다 (§0).
  if (form.assemble) {
    const a = form.assemble(ctx)
    return { ok: true, kind: form.kind, title: a.title, result: a.result, body: a.body, model: 'template' }
  }

  const model = env.OPENAI_LEGAL_MODEL || 'gpt-4o'
  // **밖으로 나가기 전에 가린다** (021). 서면도 상담과 같은 취급이다.
  // 날짜·금액·이름은 가리지 않는다 — 가리면 소장을 쓸 수 없다.
  const masked = maskPii(form.brief(ctx))

  // `legalAnalysis.ts` 와 같은 방식으로 부른다 — `openai.ts` 의 `chat` 은 내부용이라
  // 밖으로 열면 영업 분석 쪽 기본값(모델·온도)이 함께 딸려 온다.
  if (!env.OPENAI_API_KEY) return { ok: false, missing: [{ msg: 'OPENAI_API_KEY 가 설정되지 않았습니다' }] }
  let parsed: Record<string, unknown> | null = null
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: form.persona },
          { role: 'user', content: masked.text },
        ],
        // 서면에서 창의성은 해롭다. 같은 사건에서 같은 문장이 나와야 한다.
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: form.schema },
      }),
    })
    if (!r.ok) {
      logLine('warn', 'document.http', {
        kind, matter: ctx.matter.id, status: r.status,
        body: (await r.text().catch(() => '')).slice(0, 200),
      })
      return { ok: false, missing: [{ msg: `모델 호출이 실패했습니다 (HTTP ${r.status})` }] }
    }
    const d = await r.json<{ choices?: { message?: { content?: string } }[] }>()
    const content = d.choices?.[0]?.message?.content
    parsed = content ? (JSON.parse(content) as Record<string, unknown>) : null
  } catch (e) {
    logLine('warn', 'document.error', {
      kind, matter: ctx.matter.id, err: e instanceof Error ? e.message : String(e),
    })
    return { ok: false, missing: [{ msg: '모델 호출 중 오류가 났습니다. 다시 시도해 주십시오.' }] }
  }

  if (!parsed) {
    logLine('warn', 'document.empty', { kind, matter: ctx.matter.id })
    return { ok: false, missing: [{ msg: '모델이 결과를 내지 못했습니다. 다시 시도해 주십시오.' }] }
  }

  return {
    ok: true,
    kind: form.kind,
    title: form.title(ctx),
    result: parsed,
    // **본문은 우리가 만든다.** 금액·당사자·법원은 모델 출력이 아니라 우리 값이다.
    body: form.render(parsed, ctx),
    model,
  }
}
