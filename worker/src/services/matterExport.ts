/**
 * 사건 하나를 통째로 꺼내고, 지운다 (030).
 *
 * ── 왜 「사본」 이 이 파일의 절반인가 ──
 *
 * **되돌릴 수 없는 삭제 전에는 목록과 사본을 남긴다.** 이 제품의 규칙이다.
 * 그런데 「내려받으세요」 라고 안내만 하면 아무도 안 내려받는다 —
 * 지우려는 사람은 이미 「필요 없다」 고 판단한 사람이기 때문이다.
 *
 * 그래서 **지우는 응답에 사본을 통째로 담아 돌려준다.** 잘못 지워도 그 화면에
 * 내용이 남아 있고, 거기서 내려받을 수 있다. 안내가 아니라 구조로 지킨다.
 *
 * ── 무엇이 사라지고 무엇이 남는가 ──
 *
 * 외래키가 정한다. 지우기 전에 **사람에게 그대로 보여 준다** — 추측하게 두지 않는다.
 *
 *   함께 사라진다  상대방 · 기한 · 증거 · 서면 · 요건사실 · 시계열   (CASCADE)
 *   남는다        상담 · 녹음 · 전사 · 분석                        (matter_id 만 비워진다)
 *
 * 녹음이 함께 지워지지 않는다는 것이 중요하다. 사건을 정리해도 **원본은 남는다.**
 */
import type pg from 'pg'

export interface MatterExport {
  matter: Record<string, unknown>
  client: Record<string, unknown> | null
  adverseParties: Record<string, unknown>[]
  deadlines: Record<string, unknown>[]
  elements: Record<string, unknown>[]
  timeline: Record<string, unknown>[]
  evidence: Record<string, unknown>[]
  documents: Record<string, unknown>[]
  /** 이 사건에 붙어 있는 상담. **지워지지 않는다** — 무엇이 떨어져 나갈지 알리려고 담는다. */
  meetings: Record<string, unknown>[]
  exportedAt: string
}

/** 지우면 무엇이 사라지고 무엇이 남는지. 화면이 그대로 보여 준다. */
export interface DeletePreview {
  title: string
  status: string | null
  /** 함께 사라지는 것 */
  destroys: { adverseParties: number; deadlines: number; elements: number
              timeline: number; evidence: number; documents: number }
  /** 남지만 이 사건에서 떨어져 나가는 것 */
  detaches: { meetings: number; recordings: number }
}

export async function exportMatter(
  db: pg.Client, id: string, userId: string, isAdmin: boolean,
): Promise<MatterExport | null> {
  const m = (await db.query(
    `select m.*, c.company_name as client_name
       from v2.matters m left join v2.customers c on c.id = m.client_id
      where m.id = $1 and ($2 or m.user_id = $3)`, [id, isAdmin, userId])).rows[0]
  if (!m) return null

  const q = (sql: string) => db.query(sql, [id]).then((r) => r.rows as Record<string, unknown>[])
  const [adv, dl, el, tl, ev, doc, mt] = await Promise.all([
    q('select * from v2.adverse_parties where matter_id = $1 order by name'),
    q('select * from v2.deadlines where matter_id = $1 order by due_on'),
    q('select * from v2.legal_elements where matter_id = $1 order by sort_order, element'),
    q('select * from v2.timeline_events where matter_id = $1 order by occurred_on nulls last'),
    q('select * from v2.evidence where matter_id = $1 order by kind'),
    // **서면은 본문까지 담는다.** 이것이 사본의 핵심이다 — 다시 만들 수 없다.
    q('select * from v2.legal_documents where matter_id = $1 order by created_at'),
    q(`select id, title, kind, start_time, created_at, analysis_status,
              (select count(*) from v2.meeting_recordings r where r.meeting_id = x.id) as recordings
         from v2.meetings x where x.matter_id = $1 and x.deleted_at is null
         order by created_at`),
  ])

  const { client_name, ...matter } = m
  return {
    matter,
    client: matter.client_id ? { id: matter.client_id, name: client_name } : null,
    adverseParties: adv, deadlines: dl, elements: el, timeline: tl,
    evidence: ev, documents: doc, meetings: mt,
    exportedAt: new Date().toISOString(),
  }
}

export function previewOf(x: MatterExport): DeletePreview {
  return {
    title: String(x.matter.title ?? ''),
    status: (x.matter.status as string | null) ?? null,
    destroys: {
      adverseParties: x.adverseParties.length, deadlines: x.deadlines.length,
      elements: x.elements.length, timeline: x.timeline.length,
      evidence: x.evidence.length, documents: x.documents.length,
    },
    detaches: {
      meetings: x.meetings.length,
      recordings: x.meetings.reduce((n, m) => n + Number(m.recordings ?? 0), 0),
    },
  }
}
