// 등록한 목소리 클립을 STT 가 받는 형태로 바꾼다.
//
// multipart 로 보낼 때 `known_speaker_references[]` 는 **data URL** 이어야 한다(API 요구).
// 클립은 2~10초라 크지 않다 — 8초 webm 이 대략 60~120KB 다.

import type { Env } from './env'
import type { VoiceEnrollment } from '../services/users'
import type { KnownSpeaker } from '../services/openai'

/** 한 번에 넘길 수 있는 등록 인원. 문서상 4명이고, 우리는 본인 하나만 쓴다. */
export const MAX_KNOWN_SPEAKERS = 4

/**
 * R2 에서 클립을 읽어 data URL 로 만든다.
 * **실패하면 빈 배열이다** — 등록이 안 붙는 것은 아쉬운 일이지만, 전사를 막을 이유는 아니다.
 */
export async function toKnownSpeakers(
  env: Env, enrollments: (VoiceEnrollment | null)[],
): Promise<KnownSpeaker[]> {
  const out: KnownSpeaker[] = []
  for (const e of enrollments.slice(0, MAX_KNOWN_SPEAKERS)) {
    if (!e) continue
    try {
      const obj = await env.UPLOADS?.get(e.ref.storage_path)
      if (!obj) {
        console.warn(`voice ref missing in R2: ${e.ref.storage_path}`)
        continue
      }
      const bytes = new Uint8Array(await obj.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }
      // **파라미터를 떼어낸다.** `mr.mimeType` 은 보통 `audio/webm;codecs=opus` 라
      // 그대로 쓰면 `data:audio/webm;codecs=opus;base64,…` 가 된다. RFC 2397 상
      // 문법 위반은 아니지만 파라미터가 끼면 거절하는 파서가 흔하고, 그러면
      // **4xx 도 안 나고 실명만 조용히 안 붙는다** — 관측된 모양과 맞는다 (2026-08-20).
      // 읽는 쪽에서 떼야 **재등록 없이 이미 저장된 행도 살아난다.**
      const mime = (e.ref.mime || 'audio/webm').split(';')[0].trim()
      out.push({ name: e.name, dataUrl: `data:${mime};base64,${btoa(bin)}` })
    } catch (err) {
      console.warn(`voice ref load failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return out
}
