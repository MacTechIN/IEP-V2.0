// 분석 Workflow — 사내 백엔드의 fire-and-forget 파이프라인 이관분 (C-5-2)
//
// 왜 Workflow 인가
//   사내 백엔드는 응답을 보낸 뒤 `setImmediate` 로 분석을 돌렸다. Workers 에는 그런 것이 없고,
//   응답 이후의 작업은 종료된다. `ctx.waitUntil()` 은 살려 주긴 하지만 **내구성이 없다** —
//   중간에 죽으면 흔적 없이 사라진다. STT 는 오디오 길이에 비례해 수 분에서 수십 분이다.
//
// 단계 경계는 **비싼 것 앞뒤로** 잡았다. STT 가 시간도 비용도 지배하므로 홀로 한 단계다.
// 리포트 생성에서 실패했다고 전사를 다시 하면 오디오 1분당 $0.021 이 또 나간다.
//
// 진행률은 **단계에서 나온다.** 사내 백엔드는 1.5초마다 `Math.random() * 20` 을 더했다 —
// 사용자가 자기 분석의 진행 상황으로 읽는 값이 난수였다. 그 티커는 옮기지 않았다.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import pg from 'pg'
import type { Env } from '../lib/env'
import { connectionString } from '../lib/db'
import { logLine } from '../lib/log'
import { toKnownSpeakers } from '../lib/voice'
import * as U from '../services/users'
import { insertBatches } from '../services/insertBatch'
import { checkAnalysis } from '../services/analysisGate'
import * as AI from '../services/openai'
import * as REC from '../services/recordings'
import * as SM from '../services/speakerMerge'
import * as LA from '../services/legalAnalysis'
import * as LP from '../services/legalPersist'
import { maskPii } from '../lib/pii'

/** 페르소나를 고칠 때 올린다. 프롬프트 전후를 비교하려면 어느 판으로 뽑았는지 알아야 한다. */
const PERSONA_REV = '2026-08-25'

/**
 * 클라이언트가 구간을 겹치는 길이. **`UploadPage.tsx` 의 `OVERLAP_MS` 와 같아야 한다.**
 * 어긋나면 겹침 창을 잘못 잡아 이을 것을 못 잇는다(작으면) 또는
 * 겹치지 않은 말까지 대조 대상이 된다(크면).
 */
const SEGMENT_OVERLAP_MS = 15 * 1000
import type { DiarizedSegment } from '../services/openai'

export interface AnalysisParams {
  meetingId: string
  /** audio: R2 에 올라온 파일 · recordings: 저장된 전사문 합치기 · metadata: 제목만 */
  source: 'audio' | 'recordings' | 'metadata'
  r2Key?: string
  recordingIds?: string[]
}

const STAGE = {
  audio: { name: '오디오 확보 중', progress: 10 },
  stt: { name: '음성 인식·화자 분리 중', progress: 45 },
  segments: { name: '화자 역할 판정 중', progress: 60 },
  analysis: { name: '기본 분석 중', progress: 75 },
  report: { name: '리포트·코칭 생성 중', progress: 95 },
  done: { name: '완료', progress: 100 },
} as const

/** 요청 하나짜리 연결. Hyperdrive 가 재사용을 대신한다. */
async function withDb<T>(env: Env, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionString(env).url })
  await client.connect()
  try { return await fn(client) } finally { await client.end().catch(() => {}) }
}

async function setStage(env: Env, meetingId: string, stage: { name: string; progress: number }) {
  await withDb(env, (db) => db.query(
    `update v2.meetings
        set analysis_status = 'processing', analysis_stage = $2, analysis_progress = $3,
            analysis_error = null, updated_at = now()
      where id = $1`, [meetingId, stage.name, stage.progress]))
  // 단계가 바뀔 때마다 한 줄. 화면이 "95%에서 멈춤" 으로 보일 때, 서버가 어디까지 갔는지
  // 로그만으로 판정할 수 있어야 한다 — 2026-08-11 에는 DB 를 직접 열어야 알 수 있었다.
  logLine('info', 'analysis.stage', { mid: meetingId, stage: stage.name, pct: stage.progress })
}

/** 역할별 발화수·턴·질문·발화시간·비율·WPM. 코드로 계산한다 — LLM 이 아니다. */
function computeTalkMetrics(segments: DiarizedSegment[], roles: Record<string, string>) {
  const byLabel: Record<string, { words: number; turns: number; questions: number; talkMs: number }> = {}
  let totalMs = 0, maxEnd = 0
  for (const seg of segments) {
    // 격리된 화자는 이미 사람이 읽을 이름을 달고 온다 (`구간 2 · 고객`).
    // 여기서 `roles` 만 보면 `P2:B` 가 그대로 지표의 키가 되어 화면과 어긋난다.
    const label = seg.speaker_label || roles[seg.speaker] || `화자 ${seg.speaker}`
    byLabel[label] ??= { words: 0, turns: 0, questions: 0, talkMs: 0 }
    const words = seg.text.trim() ? seg.text.trim().split(/\s+/).length : 0
    const ms = Math.max(0, (seg.end_ms || 0) - (seg.start_ms || 0))
    byLabel[label].words += words
    byLabel[label].turns += 1
    byLabel[label].questions += (seg.text.match(/\?|까\?|나요|가요/g) || []).length ? 1 : 0
    byLabel[label].talkMs += ms
    totalMs += ms
    if ((seg.end_ms || 0) > maxEnd) maxEnd = seg.end_ms || 0
  }
  const totalWords = Object.values(byLabel).reduce((a, b) => a + b.words, 0) || 1
  const shape = (m: { words: number; turns: number; questions: number; talkMs: number }) => {
    const talkRatio = totalMs > 0 ? m.talkMs / totalMs : m.words / totalWords
    return {
      words: m.words, turns: m.turns, questions: m.questions, talkMs: m.talkMs,
      talkRatio: Math.round(talkRatio * 100) / 100,
      wpm: m.talkMs > 0 ? Math.round(m.words / (m.talkMs / 60000)) : 0,
    }
  }
  const speakers: Record<string, unknown> = {}
  for (const [label, m] of Object.entries(byLabel)) speakers[label] = shape(m)

  /**
   * **역할로도 묶어 낸다** (2026-08-27).
   *
   * 구간이 여러 개인 녹음은 같은 사람이 구간마다 다른 화자로 갈린다(겹침이 없으면
   * 이을 수 없다). 그러면 화자별 수치는 잘게 부서져 **아무것도 알려 주지 않는다** —
   * 실제 두 명인 미팅에 45장이 뜨고 발화 비율이 전부 한 자리였다.
   *
   * 역할은 **말한 내용으로 추정한 것**이라 근거가 아니다. 그래서 화자별 수치를
   * 지우지 않고 **나란히 둔다.** 틀렸으면 사람이 화자별을 보고 알아볼 수 있어야 한다.
   *
   * 역할을 못 정한 화자는 `미상` 으로 모은다 — 빼면 합이 100%가 안 되어
   * 「어디로 갔지」 가 된다.
   */
  const byRole: Record<string, { words: number; turns: number; questions: number; talkMs: number }> = {}
  for (const seg of segments) {
    const label = seg.speaker_label || roles[seg.speaker] || `화자 ${seg.speaker}`
    const role = roles[seg.speaker]
    // 역할 판정이 안 된 것은 `화자 X` 로 돌아온다 — 그건 역할이 아니다.
    const key = role && !role.startsWith('화자 ') ? role : '미상'
    byRole[key] ??= { words: 0, turns: 0, questions: 0, talkMs: 0 }
    byRole[key].words += seg.text.trim() ? seg.text.trim().split(/\s+/).length : 0
    byRole[key].turns += 1
    byRole[key].questions += (seg.text.match(/\?|까\?|나요|가요/g) || []).length ? 1 : 0
    byRole[key].talkMs += Math.max(0, (seg.end_ms || 0) - (seg.start_ms || 0))
    void label
  }
  const rolesOut: Record<string, unknown> = {}
  for (const [k, m] of Object.entries(byRole)) rolesOut[k] = shape(m)

  return {
    durationMs: maxEnd,
    speakers,
    /** 역할별 집계. **추정이다** — 화자별과 나란히 둔다. */
    roles: rolesOut,
    /** 화자가 몇으로 갈렸는가. 화면이 「실제 인원이 아니다」 를 말할 근거. */
    speakerCount: Object.keys(byLabel).length,
  }
}

/**
 * 「실패는 아니지만 덜 된 것」을 남긴다 (028).
 * 이걸 못 남겨도 분석 자체를 멈추지는 않는다 — 안내를 못 띄우는 것이 분석을 버리는 것보다 낫다.
 */
async function noteAnalysis(env: Env, meetingId: string, note: string) {
  await withDb(env, (db) => db.query(
    'update v2.meetings set analysis_note = $2 where id = $1', [meetingId, note]))
    .catch((e) => logLine('warn', 'analysis.note_failed', {
      mid: meetingId, err: e instanceof Error ? e.message : String(e),
    }))
}

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, AnalysisParams> {
  async run(event: WorkflowEvent<AnalysisParams>, step: WorkflowStep) {
    const env = this.env
    const { meetingId, source, r2Key } = event.payload

    try {
      await step.do('시작 표시', async () => {
        await withDb(env, (db) => db.query(
          // note 도 함께 비운다 — 지난 실행의 안내가 새 실행 결과처럼 남으면 안 된다 (028)
          `update v2.meetings set analysis_started_at = now(), analysis_error = null,
                  analysis_note = null where id = $1`,
          [meetingId]))
        await setStage(env, meetingId, STAGE.audio)
      })

      // ── 선택한 녹음의 전사가 끝났는지 확인한다 (2026-08-11)
      //
      // 전사가 업로드 요청 밖으로 나가면서, 사용자가 폼을 다 채우고 "분석" 을 누르는 시점에
      // 아직 전사 중인 녹음이 있을 수 있다. 그대로 진행하면 **전사문 없이 제목만으로**
      // 분석돼 버린다 — 예전에 사용자가 겪은 그 결과가 정상 경로에서 재현되는 셈이다.
      //
      // 그래서 여기서 막는다. 아직인 것은 직접 집어 전사하고(잠금이 중복 STT 를 막는다),
      // 남이 잡고 있으면 던져서 재시도로 기다린다 — 20초 × 10회 = 최대 200초.
      // 그래도 안 되면 **막지 않고 진행한다.** 있는 것만으로 분석하는 편이,
      // 아무것도 못 받는 것보다 낫다. 무엇이 빠졌는지는 transcribe_error 에 남는다.
      if (source === 'recordings') {
        // 재시도를 다 쓰면 step.do 가 던진다. **여기서 받아 삼킨다** —
        // 위에 적은 "막지 않고 진행한다" 는 이 catch 가 없으면 성립하지 않는다.
        try {
          await step.do('녹음 전사 확인', { retries: { limit: 10, delay: '20 seconds' } }, async () => {
            const ids = event.payload.recordingIds || []
            if (!ids.length) return
            const rows = await withDb(env, (db) => db.query<{ id: string; transcribe_status: string }>(
              `select id, transcribe_status from v2.meeting_recordings
                where id = any($1::uuid[]) order by sort_order asc`, [ids]))
            const todo = rows.rows.filter((r) => r.transcribe_status !== 'done')
            if (!todo.length) return

            logLine('info', 'analysis.await_transcribe', {
              mid: meetingId, total: rows.rows.length, pending: todo.length,
            })
            // 순서대로 하나씩. 보통은 전사 Workflow 가 이미 끝내 둬서 여기까지 오지 않는다.
            let waiting = 0
            for (const r of todo) {
              const out = await REC.transcribeRecording(env, r.id, 'an')
              if (out.status === 'busy') waiting += 1
            }
            // 남이 잡고 있는 것이 남았으면 재시도로 다시 확인한다.
            // exhausted·failed 는 다시 봐도 같으므로 던지지 않는다.
            if (waiting) throw new Error(`전사 대기 중인 녹음 ${waiting}개`)
          })
        } catch (e) {
          logLine('warn', 'analysis.transcribe_incomplete', {
            mid: meetingId, err: e instanceof Error ? e.message : String(e),
          })
        }
      }

      // ── 전사 (source 에 따라 다르다. 나머지 단계는 공통)
      // 게이트가 볼 값. 구간이 하나면 병합 자체가 없으므로 기본값이 그대로 간다.
      let mergedParts = 1
      let mergedLinks = 0
      const stt = await step.do('전사', { retries: { limit: 2, delay: '10 seconds' } }, async () => {
        if (source === 'metadata') return null
        await setStage(env, meetingId, STAGE.stt)

        if (source === 'audio') {
          if (!r2Key) throw new Error('r2Key 가 없습니다')
          const obj = await env.UPLOADS?.get(r2Key)
          if (!obj) {
            // 없는 파일은 다시 시도해도 없다. 재시도 대상이 아니라는 것을 이름으로 알린다.
            // (Workflow 는 던진 오류를 재시도하므로, 여기서 소진시키는 대신 즉시 실패로 만든다)
            throw new NonRetryableError(`R2 에 객체가 없습니다: ${r2Key}`)
          }
          const blob = await obj.blob()
          const name = r2Key.split('/').pop() || 'audio'
          // 미팅 소유자가 목소리를 등록해 뒀으면 함께 보낸다. 본인 발화에만 실명이 붙는다.
          const known = await withDb(env, async (db) => {
            const owner = await db.query<{ user_id: string }>(
              'select user_id from v2.meetings where id = $1', [meetingId])
            const uid = owner.rows[0]?.user_id
            return uid ? toKnownSpeakers(env, [await U.getEnrollment(db, uid)]) : []
          })
          return AI.transcribeAudio(env, blob, name, known)
        }

        // recordings: 이미 전사된 것을 합친다. STT 를 다시 부르지 않는다.
        const ids = event.payload.recordingIds || []
        if (!ids.length) return null
        const rows = await withDb(env, (db) => db.query<{ id: string; transcription: string; segments: unknown }>(
          `select id, transcription, segments from v2.meeting_recordings
            where id = any($1::uuid[]) order by sort_order asc`, [ids]))
        // 원문은 **중복을 걷어낸 뒤** 세그먼트에서 다시 만든다 (아래).
        // 구간별 `transcription` 을 그대로 이으면 겹친 15초가 두 번 들어가 요약이 그것을 본다.
        const rawText = rows.rows.map((r) => r.transcription || '').filter(Boolean).join('\n\n')
        // **어느 녹음에서 온 줄인지 함께 담는다** (012).
        // 각 녹음의 시각은 그 파일의 0초 기준이라, 출처를 모르면 재생 위치가 되지 않는다 —
        // 미팅 하나에 녹음이 넷이면 시각이 네 번 0으로 돌아간다.
        //
        // ── 구간 경계에서 화자를 **격리하고, 근거가 있으면 다시 잇는다**
        //
        // STT 는 **파일 하나마다 독립적으로** A·B·C 를 붙인다. 파트1 의 `화자 A` 와
        // 파트5 의 `화자 A` 는 아무 관계가 없는데, 그전에는 이름표를 그대로 이어붙였다 —
        // `화자 A 267개` 가 **서로 다른 최소 4명이 뭉친 것**이었다 (2026-08-20).
        //
        // 2026-08-22 에 격리해서 **잘못 합쳐지는 것**을 없앴고,
        // 2026-08-25 에 **겹침 정렬**로 다시 잇는다 — 구간을 15초 겹쳐 녹음하므로
        // 같은 발화가 두 구간에 함께 나오고, 글자가 일치하면 같은 사람이다.
        // **근거가 없으면 잇지 않는다.** 갈린 채로 두는 것이 잘못 합치는 것보다 낫다.
        //
        // 겹침이 없는 옛 녹음에서는 아무것도 이어지지 않고 격리 상태 그대로다.
        const ownerNames = await withDb(env, async (db) => {
          const owner = await db.query<{ user_id: string }>(
            'select user_id from v2.meetings where id = $1', [meetingId])
          const uid = owner.rows[0]?.user_id
          if (!uid) return new Set<string>()
          const e = await U.getEnrollment(db, uid)
          return new Set(e?.name ? [e.name] : [])
        })

        const partList = rows.rows.map((r) => ({
          id: r.id,
          segments: ((Array.isArray(r.segments) ? r.segments : []) as DiarizedSegment[])
            // 옛 행에는 `speaker_raw` 가 없다 — 그때는 이름표 자체로 격리한다.
            .map((sg) => ({ ...sg, speaker: sg.speaker_raw || sg.speaker })),
        }))
        const merged = SM.mergeSpeakers(partList, {
          overlapMs: SEGMENT_OVERLAP_MS, globalNames: ownerNames,
        })

        const segments: DiarizedSegment[] = []
        partList.forEach((p, i) => {
          const drop = merged.dropped.get(i)
          const original = (Array.isArray(rows.rows[i].segments) ? rows.rows[i].segments : []) as DiarizedSegment[]
          p.segments.forEach((sg, j) => {
            // 겹쳐서 두 번 실린 발화는 **뒤 구간 것을 버린다.** 앞 구간이 시간상 먼저다.
            if (drop?.has(j)) return
            const raw = sg.speaker
            const id = ownerNames.has(raw) ? raw : SM.isolatedId(i, raw)
            const group = merged.groupOf.get(id) ?? id
            segments.push({
              speaker: group,
              // 이어진 뒤의 이름이다. `구간 2 · 고객` 이 아니라 회의 전체에서 `화자 B` 다.
              speaker_label: merged.labelOf.get(group) || `화자 ${raw}`,
              speaker_raw: raw,
              start_ms: sg.start_ms, end_ms: sg.end_ms,
              text: original[j]?.text ?? sg.text,
              recording_id: p.id,
            })
          })
        })

        mergedParts = partList.length
        mergedLinks = merged.links
        // **몇이 몇으로 줄었는지 남긴다.** 겹침이 실제로 도는지 이 숫자로 잰다.
        logLine('info', 'analysis.speakers_merged', {
          mid: meetingId, parts: partList.length,
          isolated: merged.before, merged: merged.after, links: merged.links,
          dropped: [...merged.dropped.values()].reduce((n, sset) => n + sset.size, 0),
        })

        /**
         * **못 이었으면 그렇다고 적는다** (2026-08-27).
         *
         * 겹침 정렬은 근거가 없으면 잇지 않는다 — 그 판단은 옳다.
         * 그런데 **못 이었다는 사실이 아무 데도 안 나타났다.** 화면은 갈라진 화자를
         * 그대로 카드로 그렸고, 실제로 두 명인 미팅에 「화자 45명」 이 떴다.
         * 45개를 그리는 것보다 나쁜 것은 **왜 45개인지 알 수 없는 것**이다.
         *
         * 이 미팅의 실측: 구간 8개 · 격리 45명 · 연결 0건 · 겹침 일치 0건.
         * 원인은 녹음에 **겹침이 아예 없었던 것**이다(구간 길이 합 73.3분 = 미팅 길이).
         * 브라우저가 만든 녹음이 아니면 겹침이 없고, 그러면 이을 방법이 원리적으로 없다.
         */
        if (partList.length > 1 && merged.links === 0 && merged.after > 2) {
          await noteAnalysis(env, meetingId,
            `녹음이 ${partList.length}개 구간으로 나뉘어 있는데 구간 사이에 겹치는 부분이 없어, `
            + `같은 사람을 구간 너머로 잇지 못했습니다. 그래서 화자가 ${merged.after}명으로 나옵니다 `
            + `— 실제 인원이 아닙니다. 대화 지표의 화자별 수치도 그만큼 잘게 쪼개져 있습니다.`)
        } else if (merged.after > 12) {
          await noteAnalysis(env, meetingId,
            `화자가 ${merged.after}명으로 잡혔습니다(구간 ${partList.length}개, 연결 ${merged.links}건). `
            + '실제 인원보다 많다면 녹음 품질이나 구간 겹침을 확인해 주십시오.')
        }
        const text = segments.map((sg) => sg.text).filter(Boolean).join(' ') || rawText
        return text ? { text, segments } : null
      })

      // ── 화자 역할 + 세그먼트 저장
      const seg = await step.do('화자 역할·세그먼트', async () => {
        if (!stt?.text) return { roles: {} as Record<string, string>, blocked: false }
        await setStage(env, meetingId, STAGE.segments)

        /**
         * **병합이 끝난 뒤에 역할을 판정한다** (2026-08-27).
         *
         * 예전에는 `recordings` 경로에서 「이미 역할이 붙어 있다」 고 보고 건너뛰었다.
         * 그런데 파트별로 붙은 `변호사`·`의뢰인` 은 **병합이 `speaker_raw` 를 쓰면서
         * 버려진다.** 그 결과 구간이 여러 개인 녹음은 역할 판정이 한 번도 일어나지 않고,
         * 화면에는 `화자 A`…`화자 AS` 만 남았다 (실제 두 명인 미팅에 45명).
         *
         * 겹침이 없으면 구간을 이을 수 없지만, **말한 내용은 남아 있다.**
         * 병합으로 만들어진 그룹들을 한 번에 놓고 「이 사람은 변호사인가 의뢰인인가」 를
         * 묻는다 — 모델 호출 한 번이고, 겹침이 필요 없다.
         *
         * **추정이지 근거가 아니다.** 그래서 원래 화자 이름을 지우지 않고 **덧붙인다** —
         * 틀렸을 때 사람이 알아볼 수 있어야 한다.
         */
        const r: Record<string, string> = await AI.mapSpeakerRoles(env, stt.segments)

        /**
         * **한 트랜잭션으로 바꾼다** (2026-08-27).
         *
         * 예전에는 `delete` 뒤에 세그먼트를 **한 줄씩** 넣었다. 트랜잭션도 없었다.
         * 1027줄짜리 미팅을 다시 분석하면 **5분 동안 전사가 반쯤 빈 채로 보인다** —
         * 실측으로 739 → 936 → 1027 로 차오르는 것을 사용자가 보고 있었다.
         * 중간에 실패하면 그 반쪽이 그대로 남는다.
         *
         * 묶어서 넣으면 왕복이 1027번에서 여섯 번으로 준다. 실패하면 옛것이 그대로다.
         */
        /**
         * **덮기 전에 한 번 본다** (2026-08-27 · `services/analysisGate.ts`).
         *
         * 여기가 파괴가 일어나는 자리다 — 아래 `delete` 가 옛 녹취를 지운다.
         * 새 결과가 옛 결과보다 명백히 나쁘면(전사문이 비었다·반토막이 났다)
         * **지우지 않고 그대로 둔다.** 이유는 화면에 적는다.
         */
        const prev = await withDb(env, async (db) => {
          const a = await db.query<{ n: string; chars: string; s: string }>(
            `select (select count(*) from v2.transcript_segments where meeting_id = $1)::text as n,
                    length(coalesce((select transcription from v2.meetings where id = $1),''))::text as chars,
                    (select (summary is not null and summary <> '')::text
                       from v2.analysis_results where meeting_id = $1) as s`, [meetingId])
          const row = a.rows[0]
          if (!row || Number(row.n) === 0) return null   // 첫 분석이다 — 지킬 옛것이 없다
          return {
            segmentCount: Number(row.n),
            transcriptChars: Number(row.chars),
            hasSummary: row.s === 'true',
          }
        })
        const labels = Array.from(new Set(stt.segments.map((sg) =>
          (sg as { speaker_label?: string }).speaker_label || r[sg.speaker] || `화자 ${sg.speaker}`)))
        const gate = checkAnalysis(prev, {
          segmentCount: stt.segments.length,
          transcriptChars: (stt.text || '').length,
          summary: null,          // 요약은 아직 안 만들었다 — 뒤 단계가 만든다
          speakerLabels: labels,
          roleKeys: Array.from(new Set(Object.values(r).filter((v) => !v.startsWith('화자 ')))),
          parts: mergedParts, links: mergedLinks,
        })
        // **나란히 적는다.** 새 값만 찍으면 나빠진 것을 알 수 없다.
        logLine('info', 'analysis.replaced', {
          mid: meetingId, verdict: gate.verdict,
          segments: `${prev?.segmentCount ?? 0}→${stt.segments.length}`,
          speakers: labels.length,
          roles: Array.from(new Set(Object.values(r).filter((v) => !v.startsWith('화자 ')))).length,
        })
        if (gate.verdict === 'BLOCK') {
          await noteAnalysis(env, meetingId, gate.reasons.join(' '))
          return { roles: r, blocked: true }
        }
        if (gate.verdict === 'WARN') await noteAnalysis(env, meetingId, gate.reasons.join(' '))

        /**
         * **덮기 직전에 이전 판을 남긴다** (030).
         *
         * 게이트는 「이건 결과가 아니다」 인 것을 막는다. 그런데 아무리 잘 짜도 새는 것이 있다 —
         * 2026-08-27 의 다섯 건 중 셋은 **사람이 화면을 보고 알려 줘서** 알았다.
         * 그물이 하나 더 있어야 한다.
         *
         * 열을 골라 담지 않는다(`to_jsonb(a)`). 나중에 열이 늘면 그때부터 안 담기고,
         * **그 사실을 아무도 모른다.**
         *
         * 실패해도 분석을 멈추지 않는다 — 사본을 못 남기는 것이 분석을 버리는 것보다 낫다.
         */
        // **결과를 단계 출력에 싣는다.** 워크플로의 `console.log` 는
        // `wrangler tail` 로 안 보이지만 **단계 출력은 `instances describe` 로 보인다** —
        // 조용히 실패하면 이력이 안 쌓이는 것을 알 방법이 없다 (2026-08-27 에 그랬다).
        let history = 'skip'
        try {
          await withDb(env, async (db) => {
            const n = await db.query(
              // **`::uuid` 를 못 박는다.** `select $1` 은 자리에서 타입을 못 정한다.
              `insert into v2.analysis_history (meeting_id, result, segment_count)
               select $1::uuid, to_jsonb(a),
                      (select count(*) from v2.transcript_segments where meeting_id = $1::uuid)
                 from v2.analysis_results a where a.meeting_id = $1::uuid`, [meetingId])
            history = `saved:${n.rowCount ?? 0}`
            if (n.rowCount) await db.query('select v2.keep_analysis_history($1::uuid, 5)', [meetingId])
          })
        } catch (e) {
          history = `failed:${e instanceof Error ? e.message : String(e)}`.slice(0, 160)
          logLine('warn', 'analysis.history_failed', { mid: meetingId, err: history })
        }

        await withDb(env, async (db) => {
          await db.query('begin')
          try {
          await db.query('update v2.meetings set transcription = $2 where id = $1', [meetingId, stt.text])
          await db.query('delete from v2.transcript_segments where meeting_id = $1', [meetingId])
          // recordings 경로는 위에서 이미 사람이 읽을 이름(`구간 2 · 고객`)을 만들어 뒀다.
          // audio 경로는 지금 판정한 역할을 쓴다.
          const rows = stt.segments.map((seg, i) => [
            meetingId,
            (seg as { speaker_label?: string }).speaker_label
              || r[seg.speaker] || `화자 ${seg.speaker}`,
            seg.speaker,
            seg.text, seg.start_ms, seg.end_ms, i,
            // audio 경로(단일 파일 업로드)는 녹음 행이 없다 — 그때는 null 이다.
            (seg as { recording_id?: string }).recording_id ?? null,
          ])
          for (const [sql, vals] of insertBatches(rows)) await db.query(sql, vals)
            await db.query('commit')
          } catch (e) {
            await db.query('rollback').catch(() => {})
            throw e
          }
        })
        return { roles: r, blocked: false, history }
      })

      const roles = seg.roles
      /**
       * **게이트가 막았으면 여기서 끝낸다** (2026-08-27).
       *
       * 전사를 안 덮었는데 아래 분석만 새로 쓰면 **옛 녹취에 새 요약**이 붙는다 —
       * 반쪽짜리가 되고, 그건 막은 것보다 나쁘다.
       */
      if (seg.blocked) {
        logLine('warn', 'analysis.blocked', { mid: meetingId })
        await withDb(env, (db) => db.query(
          `update v2.meetings set analysis_status = 'completed', analysis_progress = 100,
                  analysis_stage = null, updated_at = now() where id = $1`, [meetingId]))
        return
      }

      /**
       * **미팅 종류를 먼저 읽는다** (2026-08-26).
       *
       * 아래 분석 단계가 이 값으로 갈린다. 법률 상담이면 영업 분석기를 **아예 부르지 않는다** —
       * 화면에서 감추는 것으로는 부족했다. 감춰도 호출은 나가고 그 결과가 **요약에 섞여 들어갔다.**
       *
       * 실측: `kind=legal` 상담의 요약이 「고객은 깔끔한 디자인과 심플한 기능의 결합에 관심을
       * 보였으며, 제품의 시장 진입에 대한 열정을 나타냈습니다」 였다.
       * **전사문에 그런 말이 없다** — 영업 스키마(관심사·우려·딜 신호)를 채우려고 지어낸 것이다.
       */
      /**
       * **IEP 는 영업 분석기를 절대 부르지 않는다** (2026-09-01, §0).
       *
       * LEP 은 `kind='legal'` 일 때만 영업 경로를 막았다. IEP 의 모든 조사(신문·참고인·
       * 피해자·면담·회의)는 영업이 아니므로 **항상 막는다.** 영업 스키마(관심사·우려·
       * 딜 신호)를 채우려고 모델이 없는 말을 지어내는 것을 원천 차단한다.
       *
       * 「진술 분석」(모순·미확인·태도변화)은 S4 에서 별도 서비스로 붙는다.
       * 그전까지는 미팅 노트(중립 요약)만 남는다 — 그게 지금의 안전한 상태다.
       */
      const skipSalesAnalysis = true

      // ── 기본 분석 (대시보드 점수) — **영업 상담에만**
      await step.do('기본 분석', { retries: { limit: 2, delay: '10 seconds' } }, async () => {
        if (skipSalesAnalysis) {
          // 법률 상담은 아래 「법률 분해」 가 요약까지 만든다. 점수·딜 신호는 만들지 않는다 —
          // 법률 상담을 딜 강도로 채점하는 것은 이 제품이 할 일이 아니다.
          logLine('info', 'analysis.skip_sales', { mid: meetingId, at: 'basic' })
          return
        }
        await setStage(env, meetingId, STAGE.analysis)
        const meeting = await withDb(env, (db) => db.query<{
          id: string; title: string; notes: string | null
          start_time: string | null; end_time: string | null
        }>(`select id, title, notes, start_time, end_time from v2.meetings where id = $1`, [meetingId]))
        const m = meeting.rows[0]
        if (!m) throw new Error('미팅이 없습니다')

        const analysis = await AI.analyzeMeeting(env, {
          id: m.id, title: m.title, notes: m.notes,
          startTime: m.start_time, endTime: m.end_time,
        }, stt?.text)
        if (!analysis) throw new Error('분석 결과를 받지 못했습니다')

        await withDb(env, (db) => db.query(
          `insert into v2.analysis_results
             (meeting_id, customer_needs, deal_signals, scores, sentiment, key_points)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (meeting_id) do update set
             customer_needs = $2, deal_signals = $3, scores = $4,
             sentiment = $5, key_points = $6, updated_at = now()`,
          [meetingId, JSON.stringify(analysis.customerNeeds), JSON.stringify(analysis.dealSignals),
           JSON.stringify(analysis.scores), analysis.sentiment, analysis.keyPoints]))
      })

      // ── 리포트 · 심리/코칭 · 스코어카드 (전사문이 있을 때만)
      await step.do('리포트·코칭', { retries: { limit: 2, delay: '15 seconds' } }, async () => {
        if (!stt?.text) {
          /**
           * 전사문 없이 제목만으로 나온 결과다.
           *
           * **여기가 2026-08-27 사고 1이 난 자리다.** 예전에는 조건 없이 덮었다 —
           * 녹음이 여덟 개 붙어 있고 요약이 멀쩡한 미팅도 이 한 줄로 사라졌다.
           * 게이트는 전사 교체 단계에 있는데, 이 경로는 그 단계를 `!stt?.text` 로
           * 빠져나오므로 **게이트를 우회한다.** 그래서 여기서 한 번 더 본다.
           *
           * 알리는 것 자체는 옳다 — 다만 **알리려고 있는 것을 지우면 안 된다.**
           */
          const had = await withDb(env, (db) => db.query<{ n: string }>(
            `select (select count(*) from v2.transcript_segments where meeting_id = $1)::text as n`,
            [meetingId])).then((x) => Number(x.rows[0]?.n ?? 0))
          if (had > 0) {
            logLine('warn', 'analysis.keep_previous', { mid: meetingId, segments: had })
            await noteAnalysis(env, meetingId,
              `이번 분석에는 전사문이 없어 기존 결과를 그대로 두었습니다 `
              + `(녹취 ${had}줄이 남아 있습니다). 녹음을 골라 다시 분석해 주십시오.`)
            return
          }
          await withDb(env, (db) => db.query(
            `update v2.analysis_results set summary = $2, updated_at = now() where meeting_id = $1`,
            [meetingId, '⚠️ 분석된 녹음(전사문)이 없어 미팅 제목만으로 분석되었습니다. 녹음을 확인한 뒤 다시 분석하세요.']))
          return
        }
        await setStage(env, meetingId, STAGE.report)

        const { meeting, prevCtx } = await withDb(env, async (db) => {
          const mm = (await db.query<{ id: string; title: string; notes: string | null; customer_id: string | null }>(
            'select id, title, notes, customer_id from v2.meetings where id = $1', [meetingId])).rows[0]
          if (!mm) throw new Error('미팅이 없습니다')
          let ctx: string | undefined
          if (mm.customer_id) {
            const prev = await db.query<{ summary: string }>(
              `select a.summary from v2.meetings m join v2.analysis_results a on m.id = a.meeting_id
                where m.customer_id = $1 and m.id <> $2 and m.deleted_at is null and a.summary is not null
                order by m.created_at desc limit 2`, [mm.customer_id, meetingId])
            if (prev.rows.length) {
              ctx = prev.rows.map((r, i) => `(이전 미팅 ${i + 1}) ${String(r.summary).slice(0, 500)}`).join('\n')
            }
          }
          return { meeting: mm, prevCtx: ctx }
        })

        const talkMetrics = computeTalkMetrics(stt.segments, roles)
        /**
         * **법률 상담은 미팅 노트만 만든다.**
         *
         * `generateReport`·`generatePsychCoaching`·`generateScorecard` 는 전부 영업 페르소나다
         * (「B2B 세일즈 미팅 분석 전문가」·「B2B 세일즈 역량 평가자」).
         * 미팅 노트만 중립이라 남긴다 — 녹취를 구간별로 나눠 요약하는 일에는 영업/법률 구분이 없다.
         *
         * 호출이 넷에서 하나로 준다. **요금도 그만큼 준다.**
         */
        const [report, psych, scorecard, note] = skipSalesAnalysis
          ? [null, null, null,
             await AI.generateMeetingNote(env,
               { id: meeting.id, title: meeting.title, notes: meeting.notes }, stt.text)]
          : await Promise.all([
          AI.generateReport(env, { id: meeting.id, title: meeting.title, notes: meeting.notes }, stt.text, prevCtx),
          AI.generatePsychCoaching(env, stt.text, talkMetrics, prevCtx),
          AI.generateScorecard(env, stt.text),
          // 리뷰용 노트. **녹취 전체를 본다** — 다른 셋과 달리 자르지 않고 구간별로 나눠 요약한다.
          AI.generateMeetingNote(env, { id: meeting.id, title: meeting.title, notes: meeting.notes }, stt.text),
        ])
        if (skipSalesAnalysis) logLine('info', 'analysis.skip_sales', { mid: meetingId, at: 'report' })
        logLine('info', 'analysis.note', {
          mid: meetingId, chars: stt.text.length,
          topics: note?.topics.length ?? 0, decisions: note?.decisions.length ?? 0,
        })

        // **upsert 다.** 법률 상담은 위 「기본 분석」 을 건너뛰어 행이 없다 —
        // `update` 만 하면 아무 데도 안 쓰이고 조용히 사라진다.
        await withDb(env, (db) => db.query(
          `insert into v2.analysis_results (meeting_id) values ($1)
           on conflict (meeting_id) do nothing`, [meetingId]))
        await withDb(env, (db) => db.query(
          `update v2.analysis_results set
             summary = $2, interests = $3, concerns = $4, action_items = $5,
             follow_up_draft = $6, talk_metrics = $7, speaker_roles = $8,
             psych_insights = $9, coaching = $10, scorecard = $11, meeting_note = $12,
             updated_at = now()
           where meeting_id = $1`,
          [meetingId,
           report?.summary || null,
           JSON.stringify(report?.interests || []),
           JSON.stringify(report?.concerns || []),
           JSON.stringify(report?.action_items || []),
           report?.follow_up_draft || null,
           JSON.stringify(talkMetrics),
           JSON.stringify(roles),
           psych ? JSON.stringify(psych.psych_insights) : null,
           psych ? JSON.stringify(psych.coaching) : null,
           scorecard ? JSON.stringify(scorecard) : null,
           note ? JSON.stringify(note) : null]))
      })

      // ── 법률 분해 (LEP · 018)
      //
      // **미팅 종류가 `legal` 일 때만 돈다.** 일반 미팅에 걸면 요건사실이 전부
      // MISSING 으로 나와 아무 문제 없는 대화에 대고 "빠진 것 투성이" 라고 외친다 (016).
      //
      // **실패해도 미팅 분석은 완료로 끝난다** — 법률 분해는 얹는 것이지 전제가 아니다.
      // 여기서 던지면 요약·녹취까지 함께 못 쓰게 된다.
      await step.do('법률 분해', { retries: { limit: 1, delay: '20 seconds' } }, async () => {
        /**
         * **전사문이 없으면 「완료」라고만 말하지 않는다** (028).
         *
         * 2026-08-26 실측: 녹음이 안 붙은 상담을 분석하면 `completed 100%` 인데
         * 사실관계·요건·시계열·증거가 전부 비어 있었다. 변호사는 그것을
         * **「상담에서 건질 것이 없었다」로 읽는다.** 실제로는 분석이 아예 안 돈 것이다.
         *
         * 법률 상담일 때만 말한다 — 일반 미팅의 메타데이터 요약은 정상 모드다.
         */
        if (!stt?.text) {
          const k = await withDb(env, (db) => db.query<{ kind: string }>(
            'select kind from v2.meetings where id = $1', [meetingId]))
          if (k.rows[0]?.kind === 'legal') {
            await noteAnalysis(env, meetingId,
              '녹음이 없어 전사문 없이 분석했습니다. 사실관계·요건·시계열·증거는 채워지지 않습니다. '
              + '녹음을 추가하고 다시 분석하십시오.')
          }
          return
        }
        const meta = await withDb(env, async (db) => {
          const r = await db.query<{ kind: string; matter_id: string | null; title: string
                                     notes: string | null; cause: string | null }>(
            `select m.kind, m.matter_id, m.title, m.notes, mt.cause
               from v2.meetings m
               left join v2.matters mt on mt.id = m.matter_id
              where m.id = $1`, [meetingId])
          return r.rows[0]
        })
        if (meta?.kind !== 'legal') return

        // 사건의 요건 목록을 **함께 넘긴다.** 모델에게 "무슨 요건이 필요하냐" 고 묻지 않는다 —
        // 우리가 가진 목록으로 대조해야 지어내지 않는다.
        const list = await withDb(env, (db) => LP.elementChecklist(db, meta.matter_id))
        const ctx = [
          meta.title ? `사건/상담: ${meta.title}` : '',
          meta.cause ? `청구원인: ${meta.cause}` : '',
          meta.notes ? `사전 메모: ${meta.notes}` : '',
          list.length
            ? `확인해야 할 요건사실:\n${list.map((t) => `- ${t.element}${t.hint ? ` (${t.hint})` : ''}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')

        // **밖으로 나가기 전에 가린다** (021).
        // 저장된 전사문은 그대로 둔다 — 그것은 증거다. 가리는 것은 전송본뿐이다.
        // 날짜·금액·이름은 가리지 않는다. 가리면 요건도 시효도 계산할 수 없다.
        const masked = maskPii(stt.text)
        if (masked.matches.length) {
          logLine('info', 'legal.pii_masked', {
            mid: meetingId, count: masked.matches.length,
            kinds: [...new Set(masked.matches.map((m) => m.kind))].join(','),
          })
          // 대응표는 **본문과 분리 보관한다.** 같은 곳에 두면 가린 의미가 없다.
          await withDb(env, async (db) => {
            for (const m of masked.matches) {
              await db.query(
                `insert into v2.pii_masks (meeting_id, kind, token, original)
                 values ($1,$2,$3,$4) on conflict (meeting_id, token) do nothing`,
                [meetingId, m.kind, m.token, m.original])
            }
          }).catch((e) => logLine('warn', 'legal.pii_store_failed', {
            mid: meetingId, err: e instanceof Error ? e.message : String(e),
          }))
        }

        const result = await LA.analyzeLegalTranscript(env, {
          transcript: masked.text, matterContext: ctx || undefined,
        })
        if (!result) {
          // **조용히 넘어가지 않는다.** 법률 분해가 빠진 것을 화면이 알아야 한다 (SEP 의 교훈).
          // 로그만 남기면 화면은 여전히 「완료」라고 말한다 — 그래서 DB 에도 남긴다 (028).
          logLine('warn', 'legal.analysis_empty', { mid: meetingId })
          await noteAnalysis(env, meetingId,
            '법률 분해가 결과를 내지 못했습니다. 전사문이 너무 짧거나 모델 호출이 실패했을 수 있습니다. '
            + '다시 분석해 보시고, 반복되면 알려 주십시오.')
          return
        }

        const saved = await withDb(env, (db) => LP.persistLegalAnalysis(db, {
          meetingId, matterId: meta.matter_id ?? null, analysis: result,
          model: env.OPENAI_LEGAL_MODEL || 'gpt-4o', personaRev: PERSONA_REV,
        }))
        logLine('info', 'legal.persisted', { mid: meetingId, ...saved })

        /**
         * **법률 분해 결과를 「요약」 자리에 쓴다** (2026-08-26).
         *
         * 전에는 `case_summary` 와 `next_questions` 가 만들어지고도 **아무 데도 안 쓰였다.**
         * 화면의 요약 칸은 영업 분석기가 채웠다. 같은 상담을 두 페르소나가 따로 보고
         * 그중 **영업 쪽 답만 사람에게 보인** 셈이다.
         *
         * 실측 대조 (부당이득 상담) —
         *   영업 요약: "고객은 2023년 3월에 …송금했으나 …피해를 입었다고 주장"
         *              → 틀리지 않지만 **무슨 일이 있었나를 다시 말할 뿐**이다
         *   법률 요약: "박정호에게 송금한 5천만원이 **법률상 원인 없이** 이루어진 것인지 여부"
         *              → 변호사가 필요한 **한 줄**이다
         *
         * `case_summary` 는 필드 셋이라 그대로는 문장이 아니다. 여기서 엮는다 —
         * 엮는 일을 모델에게 또 시키면 호출이 하나 더 는다.
         */
        const cs = result.case_summary
        const summary = [
          cs.matter_type ? `[${cs.matter_type}]` : '',
          cs.core_dispute,
          cs.client_position,
        ].filter(Boolean).join(' ').trim() || null

        // 「물어볼 것」 이 곧 다음 상담의 할 일이다. `next_questions` 와
        // 불리한 사실·누락에 붙은 `question` 을 합치되 **같은 문장은 한 번만** 넣는다.
        /**
         * `next_questions` 와 `risk_and_gaps[].question` 은 **같은 것을 말만 바꿔 담는다.**
         * 실측(2026-08-26): 여섯 줄 중 셋이 짝지어 중복이었다 —
         *   "500만원 반환이 원금 변제인지 이자 지급인지 명확히 하십시오"
         *   "500만원 반환이 원금 변제인지 이자 지급인지 명확히 할 필요가 있음. 이는 …"
         * 문자열이 다르니 `Set` 으로는 안 걸린다.
         *
         * 그래서 **조사·어미·공백을 걷어낸 뼈대**로 비교한다. 겹치면 **먼저 온 것**을 남긴다 —
         * `next_questions` 가 앞이고, 그쪽이 사람에게 시키는 말투("~하십시오")라 읽기 좋다.
         */
        const skeleton = (q: string) => q
          .replace(/[.,·…\s]/g, '')
          .replace(/(하십시오|할 필요가 있음|이 필요함|해야 함|확인이 필요함|입니다|습니다|함)$/g, '')
          .slice(0, 40)
        const actionItems: string[] = []
        const seenQ = new Set<string>()
        for (const raw of [
          ...(result.next_questions ?? []),
          ...(result.risk_and_gaps ?? []).map((g) => g.question).filter(Boolean),
        ]) {
          const q = String(raw).trim()
          if (!q) continue
          const k = skeleton(q)
          if (!k || seenQ.has(k)) continue
          seenQ.add(k)
          actionItems.push(q)
        }

        // 주장과 위험을 핵심 포인트로. 사람이 목록으로 훑는 자리다.
        const keyPoints = [
          ...(result.claims ?? []).map((cl) => cl.claim).filter(Boolean),
          ...(result.risk_and_gaps ?? []).map((g) => g.detail).filter(Boolean),
        ].map((x) => String(x).trim()).filter(Boolean).slice(0, 12)

        await withDb(env, async (db) => {
          await db.query(
            `insert into v2.analysis_results (meeting_id) values ($1)
             on conflict (meeting_id) do nothing`, [meetingId])
          /**
           * **영업 값을 비운다.** 「기본 분석」 을 건너뛰면 그 칸을 *안 쓸* 뿐,
           * 지난 실행이 써 둔 값은 그대로 남는다 — 실측에서 `scores`·`deal_signals`·
           * `customer_needs` 가 남아 있었다. 그대로 두면 **성과 화면이 법률 상담을
           * 영업 지표로 세고**, 다시 분석해도 옛 점수가 계속 따라다닌다.
           */
          await db.query(
            `update v2.analysis_results set
               summary = $2, key_points = $3, action_items = $4, follow_up_draft = $5,
               -- **셋은 NOT NULL 이다.** null 을 넣으면 그 자리에서 터진다
               -- (2026-08-26 실측: 분석이 95%에서 failed).
               -- 「점수 없음」 을 뜻하는 것은 null 이 아니라 **기본값**이다.
               scores = default, deal_signals = default, customer_needs = default,
               -- 나머지는 nullable 이라 비운다
               psych_insights = null, coaching = null, scorecard = null,
               sentiment = null, interests = null, concerns = null,
               updated_at = now()
             where meeting_id = $1`,
            // `key_points` 는 **`TEXT[]`** 다. 문자열로 넣으면 그 자리에서 터진다.
            [meetingId, summary, keyPoints,
             JSON.stringify(actionItems), result.follow_up_draft || null])
        })
        logLine('info', 'legal.summary_written', {
          mid: meetingId, summaryChars: summary?.length ?? 0,
          actions: actionItems.length, keyPoints: keyPoints.length,
          mail: (result.follow_up_draft || '').length,
        })
      })

      await step.do('완료 표시', async () => {
        await withDb(env, (db) => db.query(
          `update v2.meetings
              set analysis_status = 'completed', analysis_stage = $2, analysis_progress = $3,
                  analysis_error = null, updated_at = now()
            where id = $1`, [meetingId, STAGE.done.name, STAGE.done.progress]))
      })
    } catch (err) {
      // **실패 원인과 중단 지점을 남긴다.** 사내 백엔드는 status 만 바꾸고 원인은 로그에만 뒀는데,
      // 그 로그는 컨테이너를 재생성하면 사라진다 (마이그레이션 006 참고).
      const message = err instanceof Error ? err.message : String(err)
      await withDb(env, (db) => db.query(
        `update v2.meetings set analysis_status = 'failed', analysis_error = $2, updated_at = now()
          where id = $1`, [meetingId, message.slice(0, 500)])).catch(() => {})
      throw err
    }
  }
}
