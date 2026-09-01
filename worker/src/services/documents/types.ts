/**
 * 서면 서식(書式)의 규격.
 *
 * ── 왜 등록부인가 ────────────────────────────────────────────
 *
 * 첫 서식은 소장이지만 **소장 전용으로 짜지 않는다.** 변호사에게 필요한 서면은 계속 는다 —
 * 내용증명 · 준비서면 · 답변서 · 위임장 · 사실조회신청 · 지급명령…
 *
 * 서식마다 라우트와 표를 만들면 서식 수만큼 코드가 늘고, 「이 사건의 서면 전부」 를
 * 묻는 곳이 서식 수만큼 갈린다. **다른 것은 내용뿐이므로 내용만 다르게 둔다.**
 *
 * 새 서식을 더하는 일 = 이 규격을 만족하는 파일 하나 + 등록부에 한 줄.
 * 표도 라우트도 화면도 손대지 않는다.
 *
 * ── 왜 `missing` 이 규격에 있는가 ────────────────────────────
 *
 * **재료가 없으면 만들지 않는다.** 원고·피고·소가 없이 소장을 뽑으면
 * 모델이 그 자리를 지어낸다 — 법원에 나가는 문서에서 그것은 사고다.
 *
 * 그래서 서식이 **자기에게 무엇이 필요한지 스스로 말하고**, 화면은 그것을
 * 「이것부터 채우십시오」 로 보여 준다. 버튼은 재료가 갖춰져야 열린다.
 */

/** 서면을 만들 때 서식에 넘기는 사건 전체. `gather()` 가 모아 준다. */
export interface DocContext {
  matter: {
    id: string; title: string; cause: string | null; matterType: string | null
    court: string | null; fileNo: string | null; notes: string | null
  }
  /** 원고 (의뢰인) */
  client: { id: string; name: string ; deleted?: boolean } | null
  /** 피고 */
  adverseParties: Array<{ name: string; role: string | null; note: string | null }>
  elements: Array<{ element: string; status: string; note: string | null }>
  timeline: Array<{ occurredOn: string | null; precision: string | null; what: string; legalMeaning: string | null }>
  evidence: Array<{ kind: string; what: string; status: string; holder: string | null; proves: string | null }>
  /** 이 조사에서 나온 확인할 것. 진술 findings 는 `refs`(원문 인용)를 들고 온다 (§0). */
  findings: Array<{ kind: string; severity: string; detail: string; question: string | null; refs: string[] }>
  /** 법률 분해 원문 (있으면) */
  legal: Record<string, unknown> | null
  /** 작성자 — 프로필 (026) */
  author: {
    name: string | null; barNo: string | null; firmName: string | null
    position: string | null; officePhone: string | null; officeAddress: string | null
  } | null
  /**
   * 조사(meeting) 자료 — **수사 서식(조서·수사보고)이 쓴다.** `meetingId` 를 준 경우에만 채워진다.
   * 소장은 사건(matter) 중심이라 이 값을 안 본다.
   */
  meeting: {
    id: string; title: string; kind: string
    /** 조사 일시 (start_time 없으면 created_at) */
    occurredAt: string | null
    /** 조사 장소·비고 (notes) */
    notes: string | null
  } | null
  /** 화자 라벨이 붙은 전사 — 조서의 문답이 된다. 없으면 빈 배열. */
  transcript: Array<{ speakerLabel: string; content: string }>
  /** 대상자 인적사항 (032). **사람이 적은 것만 있다** — 비어 있으면 조서에 빈칸으로 둔다 (§6-D). */
  subjects: Array<{ role: string; displayName: string | null; speakerLabel: string | null }>
  /** 진술 분석 요지 (S4) — 수사보고가 쓴다. */
  analysis: { summary: string | null; keyPoints: string[]; actionItems: string[] } | null
  /** 이미지 증적·참조 자료 (S7). 이유·해시·사실 설명. */
  images: Array<{ reason: string; sha256: string; summary: string | null; capturedAt: string | null }>
  /** 화면에서 받은 값. 소가·법원처럼 사건에 아직 없는 것 */
  params: Record<string, unknown>
}

/**
 * 없는 것 하나.
 *
 * `param` 이 붙어 있으면 **화면에서 지금 채울 수 있는 것**이다(소가·관할법원처럼).
 * 붙어 있지 않으면 사건 자체에 없는 것이라 다른 화면에서 채워야 한다(피고·청구원인).
 *
 * 예전에는 라우트가 「'소가' 라는 글자가 들어 있으면 입력칸」 처럼 **문구를 대조해서**
 * 갈랐다. 문구를 고치는 순간 조용히 틀리고, 새 서식은 그 규칙을 알 길이 없다.
 * 서식이 스스로 말하게 한다.
 */
export interface Missing {
  msg: string
  /** 화면의 이 입력칸에서 지금 채울 수 있다 (소가·관할법원처럼). */
  param?: string
  /**
   * **사건 자체에 없는 것.** 무엇을 채워야 하는지 이름으로 지목한다.
   *
   * 예전에는 「원고(의뢰인)가 사건에 연결되어 있지 않습니다」 라고만 했다.
   * 맞는 말이지만 **연결하는 칸이 화면 어디에도 없었다** — 사건 만들기 폼도
   * 의뢰인을 안 보냈다. 서버는 처음부터 `clientId` 를 받고 있었는데도 그랬다.
   * 이름을 주면 화면이 그 자리에 알맞은 칸을 띄운다.
   */
  fix?: 'client' | 'adverseParty' | 'cause'
}

export interface DocumentForm {
  /** 저장에 쓰는 값. 한번 정하면 바꾸지 않는다 — 이미 만든 서면이 이 값을 들고 있다. */
  kind: string
  /** 화면에 보이는 이름 */
  label: string
  /** 한 줄 설명 */
  description: string
  /**
   * 화면이 물어야 하는 값. 소가·법원처럼 **사건 데이터에 없는 것**만 여기 둔다.
   * 사건에 있는 것을 또 묻지 않는다.
   */
  params?: Array<{
    name: string
    label: string
    type: 'number' | 'text' | 'date' | 'select' | 'boolean'
    options?: string[]
    required?: boolean
    hint?: string
  }>
  /**
   * **무엇이 없어서 못 만드는가.** 빈 배열이면 만들 수 있다.
   * 화면은 이 목록을 그대로 보여 준다 — 「왜 버튼이 안 열리나」 에 답이 되어야 한다.
   */
  missing: (ctx: DocContext) => Missing[]
  /** 제목. 목록에 뜬다. */
  title: (ctx: DocContext) => string
  /** 모델에게 줄 지시. 서식마다 다른 것이 대부분 여기 있다. */
  persona: string
  /** OpenAI 구조화 출력 스키마 */
  schema: Record<string, unknown>
  /** 모델에게 넘길 사건 요약. **가공은 여기서 한다** — 모델에게 원본을 통째로 던지지 않는다. */
  brief: (ctx: DocContext) => string
  /**
   * 사람이 읽는 본문. **모델 출력을 그대로 쓰지 않는다** —
   * 금액·날짜·당사자처럼 틀리면 안 되는 것은 여기서 우리 값으로 박아 넣는다.
   */
  render: (result: Record<string, unknown>, ctx: DocContext) => string
  /**
   * **모델 없이 조립하는 서식.** 조서·수사보고처럼 「있는 그대로 기록」 하는 문서는
   * 모델을 부르지 않는다 — 지어낼 여지를 아예 두지 않는 것이 §0 에 맞다.
   * 있으면 `generateDocument` 가 persona/schema/brief/render 대신 이것만 쓴다.
   */
  assemble?: (ctx: DocContext) => { title: string; body: string; result: Record<string, unknown> }
}
