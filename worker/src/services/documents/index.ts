/**
 * 서식 등록부 (029).
 *
 * **새 서식을 더하는 일 = 파일 하나 + 아래 한 줄.**
 * 표도 라우트도 화면도 손대지 않는다 — 화면은 이 목록을 받아 그린다.
 *
 * 다음에 들어올 만한 것 (아직 없다. 있는 척하지 않는다):
 *   내용증명 · 준비서면 · 답변서 · 위임장 · 사실조회신청 · 지급명령신청
 */
import type { DocumentForm } from './types'
// 소장(complaint)은 LEP 의 서식이다 — IEP 에서는 등록하지 않는다(파일은 내력으로 남긴다).
import { statementRecord, suspectRecord, investigationReport } from './investigator'

// 수사 서식. 순서 = 조사 흐름(진술→피의자신문→보고).
const FORMS: DocumentForm[] = [statementRecord, suspectRecord, investigationReport]

/** 화면이 그릴 목록. 스키마·페르소나처럼 밖에 나갈 이유가 없는 것은 빼고 준다. */
export function listForms() {
  return FORMS.map((f) => ({
    kind: f.kind, label: f.label, description: f.description, params: f.params ?? [],
  }))
}

export function getForm(kind: string): DocumentForm | null {
  return FORMS.find((f) => f.kind === kind) ?? null
}

export type { DocumentForm, DocContext } from './types'
export { calcCosts, stampFee, serviceFee, SERVICE_ROUNDS } from './costs'
