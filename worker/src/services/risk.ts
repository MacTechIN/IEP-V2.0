// 실시간 위험 감지 — 사내 백엔드 routes/risk.ts + openaiService 의 두 함수 이관분 (C-4b)
//
// **이 경로만 먼저 옮길 수 있는 이유: 파일을 저장하지 않는다.**
// 20~30초 클립을 받아 전사하고 판정한 뒤 곧바로 버린다.
// 원본도 `finally` 에서 `fs.unlinkSync` 로 지웠다 — Worker 에서는 애초에 디스크에 쓰지 않으므로
// 지울 것도 없다. R2 도 필요 없다.
//
// 나머지 업로드 두 곳(`/meetings/:id/audio`, `/recordings`)은 파일을 보관하고
// 분석 파이프라인으로 이어지므로 C-5 와 함께 옮긴다.

import type { Env } from '../lib/env'

export type RiskLevel = 'normal' | 'caution' | 'danger' | 'opportunity'
export interface RiskAssessment {
  level: RiskLevel; reason: string; script: string; action: string
}

const STT_MODEL = 'whisper-1'
const CHAT_MODEL = 'gpt-4o-mini'

/** 짧은 클립 전사. 실패는 null 로 돌려 호출부가 '무음' 으로 처리하게 둔다. */
export async function transcribeQuick(env: Env, audio: File): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null
  const form = new FormData()
  form.append('file', audio, audio.name || 'clip.webm')
  form.append('model', env.OPENAI_STT_MODEL || STT_MODEL)
  // **여기도 언어를 건다.** 몇 초짜리 클립은 자동 판별이 가장 잘 틀리는 입력이다 —
  // 근거가 짧을수록 영어로 넘어가기 쉽다 (2026-08-20).
  form.append('language', env.OPENAI_STT_LANGUAGE || 'ko')
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    })
    if (!r.ok) {
      console.warn('quick STT failed:', r.status)
      return null
    }
    const d = await r.json<{ text?: string }>()
    return d.text ?? null
  } catch (e) {
    console.warn('quick STT error:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * 코칭 지시문은 **미팅 종류마다 다르다** (016).
 *
 * 일반 미팅에 법률 코칭을 걸면 요건 누락을 계속 외친다 —
 * 아무 문제 없는 대화에 대고 그러는 것이고, 그러면 다음부터 아무도 화면을 안 본다.
 *
 * **구조는 셋이 같다** — 등급 넷, JSON 하나, "애매하면 normal, 과잉 경보 금지".
 * SEP 에서 검증된 성질(경보 비용의 비대칭, 3초 안에 읽을 문장)을 그대로 쓰고 **내용만** 바꾼다.
 */
const COMMON_TAIL = '\n반드시 JSON 하나만: {"level":"", "reason":"감지 근거 한 줄", "script":"지금 이렇게 말해보세요 — 구체 멘트", "action":"권장 행동"}\n'
  + '애매하면 normal. 과잉 경보 금지. 모든 출력 한국어.'

/** 법률 상담 — **"이렇게 말하세요" 가 아니라 "이걸 물어보세요" 다.** */
const SYSTEM_LEGAL = '당신은 변호사의 상담을 옆에서 돕는 실시간 보조다. 방금 20~30초 대화 조각을 보고 판정한다.\n'
  + 'level: "normal"(특이 신호 없음) | "caution"(확인 필요: 날짜·금액이 모호하다 · 요건사실이 아직 안 나왔다 · 증거 소재가 불명확하다) '
  + '| "danger"(위험: 시효가 임박했을 정황 · 이해충돌 신호 · 의뢰인에게 불리한 사실이 흘러나옴 · 앞선 진술과 모순) '
  + '| "opportunity"(단서: 입증 가능한 증거가 언급됨 — 지금 확보를 요청해야 한다).\n'
  + '**script 는 변호사가 의뢰인에게 지금 던질 질문이다.** 사실을 좁히는 질문이어야 한다 — '
  + '"그 문자 받으신 게 몇 월이었는지 기억나시나요? 지금도 갖고 계신가요?" 처럼.\n'
  + '법적 결론을 단정하지 마라. 판단은 변호사가 한다.'
  + COMMON_TAIL

/** 수임 상담 — 수임을 따내는 것은 영업이다. SEP 의 지시문 그대로. */
const SYSTEM_BUSINESS = '당신은 실시간 세일즈 코치다. 방금 20~30초 대화 조각을 보고 상황을 판정한다.\n'
  + 'level: "normal"(정상) | "caution"(주의: 톤 하락·이견·가격저항) | "danger"(위험: 격앙·욕설·강한 불만·계약 파기/이탈 위협) | "opportunity"(기회: 명확한 구매신호·강한 긍정).'
  + COMMON_TAIL

/** 일반 — **거의 아무 말도 하지 않는다.** 요약은 회의가 끝난 뒤에 하면 된다. */
const SYSTEM_GENERAL = '당신은 회의를 옆에서 듣는 실시간 보조다. 방금 20~30초 대화 조각을 보고 판정한다.\n'
  + 'level: "normal"(대부분 여기다) | "caution"(오해가 생기고 있다 · 결론 없이 맴돈다) '
  + '| "danger"(감정이 격해졌다) | "opportunity"(합의·결정이 만들어지는 순간 — 확인하고 넘어가야 한다).\n'
  + '**대부분의 주기는 normal 이어야 한다.** 일반 회의에서 경보가 잦으면 방해일 뿐이다.'
  + COMMON_TAIL

export type MeetingKind = 'legal' | 'business' | 'general'

export function systemFor(kind: string | undefined): string {
  if (kind === 'legal') return SYSTEM_LEGAL
  if (kind === 'business') return SYSTEM_BUSINESS
  return SYSTEM_GENERAL      // 모르는 값은 가장 조용한 쪽으로 (016)
}

export async function assessRisk(
  env: Env, transcript: string, recentContext?: string, kind?: string,
): Promise<RiskAssessment | null> {
  if (!env.OPENAI_API_KEY || transcript.trim().length < 2) return null
  const ctx = recentContext ? `\n[직전 맥락]\n${recentContext}\n` : ''
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || CHAT_MODEL,
        messages: [
          { role: 'system', content: systemFor(kind) },
          { role: 'user', content: `${ctx}[대화 조각]\n${transcript.slice(0, 4000)}` },
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    })
    if (!r.ok) {
      console.warn('risk radar failed:', r.status)
      return null
    }
    const d = await r.json<{ choices?: { message?: { content?: string } }[] }>()
    const p = JSON.parse(d.choices?.[0]?.message?.content || '{}') as Partial<RiskAssessment>
    const level: RiskLevel =
      (['normal', 'caution', 'danger', 'opportunity'] as const).includes(p.level as RiskLevel)
        ? (p.level as RiskLevel) : 'normal'
    return { level, reason: p.reason || '', script: p.script || '', action: p.action || '' }
  } catch (e) {
    console.warn('risk radar error:', e instanceof Error ? e.message : String(e))
    return null
  }
}

// ───────────────────────────── 완충 · 기록 (015)

/**
 * **위험만 두 번 물어본다.** 비대칭이 요점이다.
 *
 * 모델이 `danger` 를 줘도 **첫 번째는 주의로 낮춘다.** 연속 두 주기가 위험일 때만 빨간 카드가 뜨고,
 * 그 사이에 위험 아닌 판정이 하나라도 오면 누적이 0으로 돌아간다.
 *
 * **왜 위험만인가** — 이것은 대화 중에 뜨는 경보다. 고객 앞에서 화면이 빨개지면
 * 영업담당의 말이 그 자리에서 흔들린다. 한 번의 오탐이 그 미팅을 망칠 수 있다.
 * 기회는 반대다 — 놓치면 그 기회만 잃으므로 즉시 띄운다.
 * **경보의 비용이 방향에 따라 다르다는 것이 이 규칙의 전부다.**
 *
 * 2026-08-24 에 클라이언트에서 서버로 옮겼다. 규칙이 화면에 있으면
 * ⑴ 기록되는 `level_shown` 을 서버가 알 수 없고 ⑵ 화면마다 다르게 구현된다.
 */
export const DANGER_STREAK_REQUIRED = 2

export function applyHysteresis(
  level: RiskLevel, prevStreak: number,
): { shown: RiskLevel; streak: number } {
  if (level !== 'danger') return { shown: level, streak: 0 }
  const streak = Math.max(0, prevStreak) + 1
  return { shown: streak < DANGER_STREAK_REQUIRED ? 'caution' : 'danger', streak }
}
