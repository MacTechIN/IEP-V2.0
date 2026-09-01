/**
 * 전사 상태를 화면 말로 바꾸는 것들. 녹음 화면과 관리자 녹음 화면이 같이 쓴다 —
 * 같은 상태가 화면마다 다른 말로 보이면 안 된다.
 */

/** 서버가 행에 적어 둔 전사 진단. 없으면 옛 행이라 아무것도 주장하지 않는다. */
export interface TranscribeNotes {
  engine?: 'diarize' | 'whisper';
  enrolled?: number;
  /** 실제로 실명이 돌아온 화자 수. **0 이어도 정상일 수 있다** — 그 구간에서 본인이 말하지 않았을 뿐이다. */
  matched?: number;
  attempts?: number;
  collapsed?: number;
  /** 클립이 거절돼 등록 없이 다시 불렀나. **이게 참일 때만 등록이 무의미해진다.** */
  retried_without_refs?: boolean;
  diarize_error?: string;
}

/**
 * 등급이 내려간 것을 **사람 말로** 한 줄.
 *
 * 2026-08-20 에 난 사고가 전부 "성공했는데 조용히 나빠진 것" 이었다.
 * 화면이 `전사 완료` 만 띄우면 620초가 세그먼트 1개로 저장된 것도 정상으로 보인다.
 */
export function degradedText(n?: TranscribeNotes | null): string {
  if (!n) return '';
  const out: string[] = [];
  if (n.engine === 'whisper') out.push('화자 구분 없이 받았습니다');
  // **`matched === 0` 만으로는 경고하지 않는다** (2026-08-24).
  //
  // 처음에는 그렇게 했다가 거짓 경보를 냈다. 구간 녹음은 10분마다 끊으므로
  // **본인이 한마디도 안 하는 10분은 흔하다.** 말하지 않은 구간에 대고 고장이라고
  // 외치는 셈이었다. 실측으로 확인했다 — 4구간 중 2구간에서 실명이 정상으로 붙었고,
  // 안 붙은 두 구간은 거절된 적이 없다(`retried_without_refs` 가 전부 false).
  //
  // 진짜 신호는 **클립이 거절돼 빼고 전사한 경우**다. 그때만 등록이 무의미해진다.
  if (n.retried_without_refs) out.push('등록한 목소리가 거절돼 빼고 전사했습니다');
  if ((n.collapsed ?? 0) > 0) out.push(`반복 ${n.collapsed}줄 접음`);
  return out.join(' · ');
}

/** 전사 상태를 사용자 말로. 상태 이름을 그대로 보여주면 무엇을 기다리는지 알 수 없다. */
export const TRANSCRIBE_TEXT: Record<string, { text: string; color: 'text.secondary' | 'success.main' | 'error' }> = {
  pending: { text: '전사 대기 중', color: 'text.secondary' },
  processing: { text: '전사 중…', color: 'text.secondary' },
  done: { text: '전사 완료', color: 'success.main' },
  failed: { text: '전사 실패 — 분석에서 제외됩니다', color: 'error' },
};
