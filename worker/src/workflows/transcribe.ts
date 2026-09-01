// 전사 Workflow — 업로드 요청에서 STT 를 떼어낸 것 (2026-08-11)
//
// 왜 옮겼나
//   `POST /recordings` 가 요청 안에서 STT 를 기다렸다. 10분짜리 하나에 실측 188초다.
//   그래서 셋이 한꺼번에 따라왔다.
//     1. **고아 파일** — 순서가 R2 저장 → STT → DB insert 라, 그 188초 안에 끊기면
//        파일만 남고 행이 없다. 2026-08-11 에 회수한 4개(40분 15초)가 그것이다.
//     2. **동시 업로드 불가** — 넷을 같이 던지면 서로 밀려 전부 제한 시간을 넘겼다.
//        지금 화면이 한 번에 하나씩 올리는 것도 그 때문이다.
//     3. **재시도 불가** — 요청이 끊기면 STT 결과도 함께 사라진다. 이미 낸 비용이 날아간다.
//
//   Workflow 는 요청 수명과 무관하게 살아 있고, 단계별로 재시도되며, 죽어도 이어서 돈다.
//   분석 파이프라인(analysis.ts)이 같은 이유로 이미 Workflow 다.
//
// 단계를 나눈 기준
//   실제 일은 `transcribeRecording` 한 곳에 있고 여기서는 한 단계로 부른다.
//   전사 안에서 STT 와 화자 판정을 더 쪼개지 않은 이유는, 그 둘 사이에 저장하는 중간 상태가
//   없어서 쪼개도 재시도가 STT 부터 다시 하기 때문이다 — 단계만 늘고 얻는 게 없다.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import type { Env } from '../lib/env'
import { logLine } from '../lib/log'
import * as REC from '../services/recordings'

export interface TranscribeParams {
  recordingId: string
}

export class TranscribeWorkflow extends WorkflowEntrypoint<Env, TranscribeParams> {
  async run(event: WorkflowEvent<TranscribeParams>, step: WorkflowStep) {
    const { recordingId } = event.payload

    // 재시도는 3회. STT 는 호출당 과금이라 무한히 되풀이하면 안 된다 —
    // 행의 transcribe_tries 가 별도로 한 번 더 막지만, 여기서 먼저 멈추는 편이 싸다.
    const result = await step.do(
      '전사', { retries: { limit: 2, delay: '20 seconds' } },
      async () => {
        const r = await REC.transcribeRecording(this.env, recordingId, 'wf')

        // 남이 잡고 있다 → 재시도할 값어치가 있다(그쪽이 실패하면 내가 집는다).
        if (r.status === 'busy') throw new Error('다른 쪽이 전사 중입니다')

        // 아래 셋은 다시 시도해도 결과가 같다. 재시도를 소진시키는 대신 즉시 끝낸다.
        if (r.status === 'exhausted') {
          throw new NonRetryableError(`시도 한도(${REC.MAX_TRANSCRIBE_TRIES}회)를 넘겼습니다`)
        }
        if (r.status === 'failed') {
          // 파일이 없는 것은 재시도로 해결되지 않는다. 그 외(네트워크·일시 오류)는 재시도한다.
          if (/R2 에 객체가 없습니다|저장 경로가 없습니다|옛 경로/.test(r.error)) {
            throw new NonRetryableError(r.error)
          }
          throw new Error(r.error)
        }
        return r
      },
    )

    logLine('info', 'transcribe.wf_done', {
      id: recordingId, status: result.status,
      chars: 'chars' in result ? result.chars : 0,
    })
    return result
  }
}
