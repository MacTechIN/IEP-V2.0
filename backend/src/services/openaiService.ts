import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';
import type { AnalysisResult, Meeting } from '../types';
import { logger } from '../utils/logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';
/**
 * 전사 언어. **보내지 않으면 모델이 요청마다 스스로 고른다.**
 * 2026-08-20 에 그 때문에 한국어 회의의 일부 구간이 영어로 전사됐다 — 이 제품의
 * 회의는 한국어에 영어 낱말이 잔뜩 섞여(TFTA·AI·solution) 자동 판별이 영어로 넘어가기
 * 가장 쉬운 조건이고, 한 번 넘어가면 그 구간 전체가 영어로 나온다.
 */
const OPENAI_STT_LANGUAGE = process.env.OPENAI_STT_LANGUAGE || 'ko';
// V1식 화자분리 STT 모델 (실패 시 whisper-1 폴백)
const OPENAI_STT_DIARIZE_MODEL = process.env.OPENAI_STT_DIARIZE_MODEL || 'gpt-4o-transcribe-diarize';

export interface DiarizedSegment {
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
  /** 원래 몇 번 연속으로 나왔나. `collapseRepeats` 가 붙인다 (2026-08-20). */
  repeated?: number;
}
export interface SttResult {
  text: string;
  segments: DiarizedSegment[];
}

// V1식 리포트 (요약/관심사/우려/딜신호/액션/팔로업이메일)
export interface V1Report {
  summary: string;
  interests: string[];
  concerns: string[];
  deal_signals: string[];
  action_items: string[];
  follow_up_draft: string;
}

// 심리 인사이트 + 코칭 (B안)
export interface PsychCoaching {
  psych_insights: {
    customer_state: string;
    rep_confidence: string;
    answer_quality: string;
    responsiveness: string;
    notes: string[];
  };
  coaching: {
    direction: string;
    preparation: string[];
    checklist: string[];
    next_appointment: string;
  };
}

// 5축 SE 스코어카드 (B안)
export interface Scorecard {
  axes: Record<string, { score: number; evidence: string; advice: string }>;
  total: number;
  headline: string;
}

// 실시간 위험·기회 레이더
export type RiskLevel = 'normal' | 'caution' | 'danger' | 'opportunity';
export interface RiskAssessment {
  level: RiskLevel;
  reason: string;   // 감지 근거 한 줄
  script: string;   // "지금 이렇게 말해보세요"
  action: string;   // 권장 행동
}

interface OpenAIAnalysisResponse {
  customer_needs: {
    primary: string;
    secondary: string[];
    budget: string;
    timeline: string;
    decision_makers: number;
    confidence: number;
  };
  deal_signals: {
    signal: 'positive' | 'neutral' | 'negative';
    strength: number;
    closing_probability: number;
    competition: string;
    next_steps: string;
  };
  scores: {
    customer_understanding: number;
    problem_solving: number;
    proposal_persuasion: number;
    follow_up: number;
    team_collaboration: number;
    overall: number;
  };
  sentiment: 'positive' | 'neutral' | 'negative';
  key_points: string[];
}

export class OpenAIService {
  private static client: AxiosInstance | null = null;

  static initialize(): void {
    if (!OPENAI_API_KEY) {
      logger.warn('⚠️  OPENAI_API_KEY not configured - analysis will use simulation mode');
      return;
    }

    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    logger.info('✓ OpenAI API initialized');
  }

  static isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Transcribe audio with speaker diarization (V1식). Tries gpt-4o-transcribe-diarize
   * (diarized_json); on failure falls back to whisper-1 (text only, single segment).
   * Returns null only if OpenAI is not configured.
   */
  static async transcribeAudio(filePath: string): Promise<SttResult | null> {
    if (!OPENAI_API_KEY) {
      logger.warn('⚠️  OPENAI_API_KEY not configured - skipping STT');
      return null;
    }

    // 1) diarizing STT
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      form.append('model', OPENAI_STT_DIARIZE_MODEL);
      form.append('response_format', 'diarized_json');
      form.append('chunking_strategy', 'auto');
      // **언어를 고정한다.** 안 보내면 구간마다 자동 판별이 돌고, 영어 낱말이 섞인
      // 한국어 회의에서 영어로 넘어간다 (2026-08-20).
      form.append('language', OPENAI_STT_LANGUAGE);

      logger.info(`Calling diarizing STT (${OPENAI_STT_DIARIZE_MODEL}) for ${filePath}`);
      const resp = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );
      const result = this.parseDiarized(resp.data);
      logger.info(`✓ diarized STT completed (${result.text.length} chars, ${result.segments.length} segments)`);
      return result;
    } catch (error: any) {
      logger.warn(`Diarizing STT failed (${error.response?.data?.error?.message || error.message}) — falling back to whisper-1`);
    }

    // 2) whisper-1 fallback (no speaker info)
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      form.append('model', OPENAI_STT_MODEL);
      // 폴백에도 같은 언어를 건다. 여기가 빠지면 주경로만 고친 셈이 된다.
      form.append('language', OPENAI_STT_LANGUAGE);
      const resp = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );
      const rawText = resp.data?.text ?? '';
      // 폴백은 전체가 한 덩이다 — 세그먼트 사이가 아니라 **문장 사이**를 접어야 한다.
      const { segments } = this.collapseRepeats(
        rawText ? [{ speaker: 'A', start_ms: 0, end_ms: 0, text: rawText }] : []);
      const text = segments[0]?.text ?? '';
      if (text.length !== rawText.length) logger.warn(`whisper repetition collapsed: ${rawText.length} → ${text.length} chars`);
      logger.info(`✓ whisper STT completed (${text.length} chars, no diarization)`);
      return { text, segments };
    } catch (error: any) {
      logger.error(`Whisper STT error: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  // diarized_json 응답을 표준 세그먼트로 파싱 (start/end 초→ms 방어적 처리)
  /**
   * ─── 반복 루프 방어 (2026-08-20)
   *
   * Whisper 계열은 **정보가 적은 구간(무음·잡음·웅얼거림)에서 직전 문장을 되풀이**한다.
   * 언어가 어긋나면 들리는 소리를 억지로 맞추느라 더 심해진다. 2026-08-20 신고에서
   * "So I explained." 이 50회 넘게 이어졌고, 그 녹취가 그대로 요약·점수의 입력이 됐다.
   *
   * **버리지 않고 접는다.** 정말 같은 말을 반복한 회의도 있으므로 앞 REPEAT_RUN_MAX 개는
   * 남기고, 몇 번이었는지를 `repeated` 에 적는다.
   */
  private static readonly REPEAT_RUN_MAX = 3;

  /** 비교용으로만 쓰는 정규화. 공백·문장부호·대소문자 차이는 같은 문장으로 본다. */
  private static repeatKey(t: string): string {
    return t.trim().toLowerCase().replace(/[\s.,!?…·"'`~\-—]+/g, '');
  }

  /** 한 세그먼트 **안에서** 같은 문장이 이어지는 것을 접는다 (whisper 폴백은 전체가 한 덩이다). */
  private static collapseWithin(text: string): { text: string; runs: number } {
    const parts = text.match(/[^.!?。…]+[.!?。…]*\s*/g);
    if (!parts || parts.length < 2) return { text, runs: 0 };
    const out: string[] = [];
    let runs = 0, key = '', run = 0;
    for (const part of parts) {
      const k = this.repeatKey(part);
      if (!k) { out.push(part); continue; }
      if (k === key) {
        run++;
        if (run > this.REPEAT_RUN_MAX) { runs++; continue; }
      } else { key = k; run = 1; }
      out.push(part);
    }
    return { text: runs ? out.join('').trimEnd() : text, runs };
  }

  /** 같은 화자가 같은 말을 연달아 하는 구간을 접는다. */
  static collapseRepeats(segments: DiarizedSegment[]): { segments: DiarizedSegment[]; dropped: number } {
    const out: DiarizedSegment[] = [];
    let dropped = 0;
    let key = '', run = 0;

    for (const raw of segments) {
      const inner = this.collapseWithin(raw.text);
      dropped += inner.runs;
      const s: DiarizedSegment = { ...raw, text: inner.text };
      const k = this.repeatKey(s.text);
      const prev = out[out.length - 1];

      if (k && prev && prev.speaker === s.speaker && k === key) {
        run++;
        // 앞 REPEAT_RUN_MAX 개는 남긴다. 그 뒤부터는 접되 **시각은 이어 붙인다** —
        // 접힌 줄만큼 오디오가 사라지면 재생 위치가 어긋난다.
        if (run > this.REPEAT_RUN_MAX) {
          prev.end_ms = Math.max(prev.end_ms, s.end_ms);
          prev.repeated = run;
          dropped++;
          continue;
        }
      } else { key = k; run = 1; }
      out.push(s);
    }
    return { segments: out, dropped };
  }

  private static parseDiarized(raw: any): SttResult {
    const rawSegs: any[] = raw?.segments || [];
    const parsed: DiarizedSegment[] = rawSegs.map((s) => {
      const start_ms = s.start_ms ?? (s.start != null ? Math.round(s.start * 1000) : 0);
      const end_ms = s.end_ms ?? (s.end != null ? Math.round(s.end * 1000) : 0);
      return {
        speaker: String(s.speaker ?? s.speaker_id ?? s.speaker_label ?? 'A'),
        start_ms,
        end_ms,
        text: s.text ?? '',
      };
    });
    // **여기서 접는다.** 이 함수를 지나면 반복 루프는 남아 있지 않다 (2026-08-20).
    const { segments, dropped } = this.collapseRepeats(parsed);
    if (dropped) logger.warn(`STT repetition collapsed: ${dropped} run(s) folded of ${parsed.length} segments`);
    // 원문 text 는 접히기 전 기준이라 다시 만든다 — 안 그러면 요약이 접기 전 문장을 본다
    const text = dropped || !raw?.text ? segments.map((s) => s.text).join(' ') : raw.text;
    return { text, segments };
  }

  /**
   * 화자 식별자를 역할(영업대표/고객)로 매핑. 이름은 추정하지 않음(안티-할루시네이션).
   * 실패 시 가장 많이 말한 화자를 영업대표로 가정.
   */
  static async mapSpeakerRoles(segments: DiarizedSegment[]): Promise<Record<string, string>> {
    const speakers = Array.from(new Set(segments.map((s) => s.speaker)));
    if (speakers.length <= 1) {
      const only = speakers[0] ?? 'A';
      return { [only]: '영업대표' };
    }
    if (!this.client) return this.fallbackRoles(segments, speakers);

    try {
      const samples = speakers
        .map((sp) => {
          const sample = segments.filter((s) => s.speaker === sp).slice(0, 5).map((s) => s.text).join(' ');
          return `화자 ${sp}: ${sample.slice(0, 400)}`;
        })
        .join('\n');

      const resp = await this.client.post('/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '화자 식별자별 발화 샘플을 보고 각 화자가 "영업대표"인지 "고객"인지 판정한다. ' +
              '이름은 판정하지 않는다. 역할만 정한다. JSON만 출력: {"화자ID":"영업대표|고객"}',
          },
          { role: 'user', content: samples },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(resp.data.choices[0].message.content);
      // 유효성 보정
      const roles: Record<string, string> = {};
      for (const sp of speakers) {
        roles[sp] = parsed[sp] === '고객' ? '고객' : parsed[sp] === '영업대표' ? '영업대표' : '화자 ' + sp;
      }
      return roles;
    } catch (error: any) {
      logger.warn(`Speaker role mapping failed: ${error.message} — using talk-volume fallback`);
      return this.fallbackRoles(segments, speakers);
    }
  }

  private static fallbackRoles(segments: DiarizedSegment[], speakers: string[]): Record<string, string> {
    // 가장 많이 말한 화자를 영업대표로 가정, 나머지는 고객
    const counts: Record<string, number> = {};
    for (const s of segments) counts[s.speaker] = (counts[s.speaker] || 0) + s.text.length;
    const rep = speakers.reduce((a, b) => ((counts[a] || 0) >= (counts[b] || 0) ? a : b), speakers[0]);
    const roles: Record<string, string> = {};
    for (const sp of speakers) roles[sp] = sp === rep ? '영업대표' : '고객';
    return roles;
  }

  // 빠른 전사 (whisper, 화자분리 없이) — 실시간 위험 레이더용 짧은 클립
  static async transcribeQuick(filePath: string): Promise<string | null> {
    if (!OPENAI_API_KEY) return null;
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      form.append('model', OPENAI_STT_MODEL);
      // 몇 초짜리 클립은 자동 판별이 가장 잘 틀리는 입력이다 — 근거가 짧을수록 잘 넘어간다.
      form.append('language', OPENAI_STT_LANGUAGE);
      const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return resp.data?.text ?? null;
    } catch (error: any) {
      logger.warn(`Quick STT error: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  // 위험·기회 레이더 판정 (대화 조각 1개)
  static async assessRisk(transcript: string, recentContext?: string): Promise<RiskAssessment | null> {
    if (!this.client || !transcript || transcript.trim().length < 2) return null;
    try {
      const ctx = recentContext ? `\n[직전 맥락]\n${recentContext}\n` : '';
      const resp = await this.client.post('/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '당신은 실시간 세일즈 코치다. 방금 20~30초 대화 조각을 보고 상황을 판정한다.\n' +
              'level: "normal"(정상) | "caution"(주의: 톤 하락·이견·가격저항) | "danger"(위험: 격앙·욕설·강한 불만·계약 파기/이탈 위협) | "opportunity"(기회: 명확한 구매신호·강한 긍정).\n' +
              '반드시 JSON 하나만: {"level":"", "reason":"감지 근거 한 줄", "script":"지금 이렇게 말해보세요 — 구체 멘트", "action":"권장 행동(경청·공감/사과/화제 전환/근거 제시/클로징 등)"}\n' +
              '애매하면 normal. 과잉 경보 금지. 모든 출력 한국어.',
          },
          { role: 'user', content: `${ctx}[대화 조각]\n${transcript.slice(0, 4000)}` },
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });
      const p = JSON.parse(resp.data.choices[0].message.content);
      const level: RiskLevel = ['normal', 'caution', 'danger', 'opportunity'].includes(p.level) ? p.level : 'normal';
      return { level, reason: p.reason || '', script: p.script || '', action: p.action || '' };
    } catch (error: any) {
      logger.warn(`Risk radar error: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  /**
   * V1식 세일즈 리포트 생성 (요약/관심사/우려/딜신호/액션/팔로업이메일).
   * transcription 이 없으면 null.
   */
  static async generateReport(
    meeting: Meeting,
    transcription: string,
    previousContext?: string,
  ): Promise<V1Report | null> {
    if (!this.client || !transcription) return null;
    try {
      const ctx = previousContext ? `\n[이전 미팅 맥락]\n${previousContext}\n` : '';
      const notes = meeting.notes ? `\n[영업자 사전 메모]\n${meeting.notes}\n` : '';
      const resp = await this.client.post('/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '당신은 B2B 세일즈 미팅 분석 전문가다. 영업 미팅 녹취 전문을 분석해 반드시 JSON 하나만 출력한다.\n' +
              '{ "summary": "미팅 핵심 요약 (2~4문장)", "interests": ["고객 관심사"], "concerns": ["고객 우려사항"], ' +
              '"deal_signals": ["가격 저항, 경쟁사 언급, 도입 의지 등 계약 신호"], "action_items": ["후속 조치"], ' +
              '"follow_up_draft": "고객에게 보낼 팔로업 이메일 초안 (인사말 포함)" }\n' +
              '단정적 판단 대신 신호 중심으로 서술한다. 모든 출력은 한국어로만.',
          },
          {
            role: 'user',
            content:
              `[미팅 제목] ${meeting.title}${notes}${ctx}\n[녹취]\n${transcription.slice(0, 12000)}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });
      const p = JSON.parse(resp.data.choices[0].message.content);
      logger.info(`✓ V1-style report generated for meeting ${meeting.id}`);
      return {
        summary: p.summary || '',
        interests: Array.isArray(p.interests) ? p.interests : [],
        concerns: Array.isArray(p.concerns) ? p.concerns : [],
        deal_signals: Array.isArray(p.deal_signals) ? p.deal_signals : [],
        action_items: Array.isArray(p.action_items) ? p.action_items : [],
        follow_up_draft: p.follow_up_draft || '',
      };
    } catch (error: any) {
      logger.error(`Report generation error: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  // 심리 인사이트 + 코칭 (B안)
  static async generatePsychCoaching(
    meeting: Meeting,
    transcription: string,
    talkMetrics?: any,
    previousContext?: string,
  ): Promise<PsychCoaching | null> {
    if (!this.client || !transcription) return null;
    try {
      const ctx = previousContext ? `\n[이전 미팅 맥락]\n${previousContext}\n` : '';
      const metrics = talkMetrics ? `\n[대화 지표]\n${JSON.stringify(talkMetrics)}\n` : '';
      const resp = await this.client.post('/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '당신은 세일즈 심리 분석 코치다. 음성/톤 정보는 없고, 오직 대화 텍스트와 계산된 지표에서만 근거를 찾는다.\n' +
              '반드시 JSON 하나만: {"psych_insights":{"customer_state":"고객 심리 상태","rep_confidence":"영업자 자신감","answer_quality":"답변 품질","responsiveness":"고객 반응성","notes":["관찰 근거"]},"coaching":{"direction":"코칭 방향","preparation":["다음 미팅 준비"],"checklist":["체크리스트"],"next_appointment":"다음 약속 제안"}}\n모든 출력 한국어.',
          },
          { role: 'user', content: `${metrics}${ctx}[녹취]\n${transcription.slice(0, 12000)}` },
        ],
        temperature: 0.7,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      const p = JSON.parse(resp.data.choices[0].message.content);
      const pi = p.psych_insights || {};
      const co = p.coaching || {};
      logger.info(`✓ Psych/coaching generated for meeting ${meeting.id}`);
      return {
        psych_insights: {
          customer_state: pi.customer_state || '',
          rep_confidence: pi.rep_confidence || '',
          answer_quality: pi.answer_quality || '',
          responsiveness: pi.responsiveness || '',
          notes: Array.isArray(pi.notes) ? pi.notes : [],
        },
        coaching: {
          direction: co.direction || '',
          preparation: Array.isArray(co.preparation) ? co.preparation : [],
          checklist: Array.isArray(co.checklist) ? co.checklist : [],
          next_appointment: co.next_appointment || '',
        },
      };
    } catch (error: any) {
      logger.error(`Psych/coaching error: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  // 5축 SE 스코어카드 (B안) — total 은 서버에서 평균 재계산
  static async generateScorecard(meeting: Meeting, transcription: string): Promise<Scorecard | null> {
    if (!this.client || !transcription) return null;
    try {
      const resp = await this.client.post('/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'B2B 세일즈 역량 평가자다. 5개 축을 각 0~100으로 평가하고 근거·조언을 단다.\n' +
              '축: question_skill(질문 기술), listening_balance(경청·발화 균형; 영업 발화 40~60%가 이상적), objection_handling(오브젝션 대응), value_articulation(가치 전달), closing_next_steps(클로징·다음 단계).\n' +
              '반드시 JSON 하나만: {"axes":{"question_skill":{"score":0,"evidence":"","advice":""},"listening_balance":{"score":0,"evidence":"","advice":""},"objection_handling":{"score":0,"evidence":"","advice":""},"value_articulation":{"score":0,"evidence":"","advice":""},"closing_next_steps":{"score":0,"evidence":"","advice":""}},"headline":"한줄평"}\n' +
              '90+ 탁월, 50 보통, 20- 미흡. 모든 출력 한국어.',
          },
          { role: 'user', content: transcription.slice(0, 12000) },
        ],
        temperature: 0.4,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      const p = JSON.parse(resp.data.choices[0].message.content);
      const axes = p.axes || {};
      const keys = ['question_skill', 'listening_balance', 'objection_handling', 'value_articulation', 'closing_next_steps'];
      const cleanAxes: Record<string, { score: number; evidence: string; advice: string }> = {};
      let sum = 0;
      for (const k of keys) {
        const a = axes[k] || {};
        const score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)));
        cleanAxes[k] = { score, evidence: a.evidence || '', advice: a.advice || '' };
        sum += score;
      }
      const total = Math.round(sum / keys.length);
      logger.info(`✓ Scorecard generated for meeting ${meeting.id} (total=${total})`);
      return { axes: cleanAxes, total, headline: p.headline || '' };
    } catch (error: any) {
      logger.error(`Scorecard error: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  static async analyzeMeeting(meeting: Meeting, transcription?: string): Promise<AnalysisResult> {
    // If OpenAI not configured, use fallback simulation
    if (!this.client) {
      return this.generateFallbackAnalysis(meeting);
    }

    try {
      const prompt = this.buildAnalysisPrompt(meeting, transcription);

      logger.info(`Calling OpenAI API for meeting ${meeting.id}`);

      const response = await this.client.post('/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are an expert sales coach analyzing sales meetings.
Analyze the meeting and provide insights in JSON format.
Focus on: customer needs, deal signals, communication effectiveness, and next steps.
Respond ONLY with valid JSON, no additional text.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const content = response.data.choices[0].message.content;
      const parsedResponse = JSON.parse(content) as OpenAIAnalysisResponse;

      const analysis: AnalysisResult = {
        meetingId: meeting.id,
        customerNeeds: {
          primary: parsedResponse.customer_needs.primary,
          secondary: parsedResponse.customer_needs.secondary,
          budget: parsedResponse.customer_needs.budget,
          timeline: parsedResponse.customer_needs.timeline,
          decisionMakers: parsedResponse.customer_needs.decision_makers,
          confidence: parsedResponse.customer_needs.confidence,
        },
        dealSignals: {
          signal: parsedResponse.deal_signals.signal,
          strength: parsedResponse.deal_signals.strength,
          closingProbability: parsedResponse.deal_signals.closing_probability,
          competition: parsedResponse.deal_signals.competition,
          nextSteps: parsedResponse.deal_signals.next_steps,
        },
        scores: {
          customerUnderstanding: parsedResponse.scores.customer_understanding,
          problemSolving: parsedResponse.scores.problem_solving,
          proposalPersuasion: parsedResponse.scores.proposal_persuasion,
          followUp: parsedResponse.scores.follow_up,
          teamCollaboration: parsedResponse.scores.team_collaboration,
          overall: parsedResponse.scores.overall,
        },
        sentiment: parsedResponse.sentiment,
        keyPoints: parsedResponse.key_points,
        createdAt: new Date().toISOString(),
      };

      logger.info(`✓ OpenAI analysis completed for meeting ${meeting.id}`);
      return analysis;
    } catch (error: any) {
      logger.error(`OpenAI API error: ${error.message}`);

      // Fallback to simulation on error
      return this.generateFallbackAnalysis(meeting);
    }
  }

  private static buildAnalysisPrompt(meeting: Meeting, transcription?: string): string {
    const durationMinutes = Math.ceil(
      (new Date(meeting.endTime).getTime() - new Date(meeting.startTime).getTime()) / 60000
    );

    if (transcription) {
      return `Analyze this sales meeting:

Title: ${meeting.title}
Duration: ${durationMinutes} minutes
Transcription:
${transcription}

Provide analysis in this exact JSON format:
{
  "customer_needs": {
    "primary": "main need identified",
    "secondary": ["need 2", "need 3"],
    "budget": "budget information or 'not discussed'",
    "timeline": "timeline or 'not specified'",
    "decision_makers": 1,
    "confidence": 0.0
  },
  "deal_signals": {
    "signal": "positive",
    "strength": 8.0,
    "closing_probability": 0.7,
    "competition": "competitor name or 'none'",
    "next_steps": "specific next action"
  },
  "scores": {
    "customer_understanding": 80,
    "problem_solving": 85,
    "proposal_persuasion": 75,
    "follow_up": 70,
    "team_collaboration": 80,
    "overall": 78
  },
  "sentiment": "positive",
  "key_points": ["key point 1", "key point 2", "key point 3"]
}`;
    }

    // Fallback prompt when no transcription
    return `Analyze this sales meeting based on metadata:

Title: ${meeting.title}
Duration: ${durationMinutes} minutes
Start: ${new Date(meeting.startTime).toLocaleString()}

Generate realistic analysis for this meeting in this JSON format:
{
  "customer_needs": {
    "primary": "inferred primary need from meeting title",
    "secondary": ["secondary need", "another need"],
    "budget": "estimated budget range or 'to be discussed'",
    "timeline": "inferred timeline from meeting context",
    "decision_makers": 1,
    "confidence": 0.6
  },
  "deal_signals": {
    "signal": "positive",
    "strength": 7.0,
    "closing_probability": 0.6,
    "competition": "likely competitors or 'unknown'",
    "next_steps": "suggested next action"
  },
  "scores": {
    "customer_understanding": 75,
    "problem_solving": 80,
    "proposal_persuasion": 70,
    "follow_up": 65,
    "team_collaboration": 75,
    "overall": 73
  },
  "sentiment": "positive",
  "key_points": ["point 1 inferred from title", "point 2", "point 3"]
}`;
  }

  private static generateFallbackAnalysis(meeting: Meeting): AnalysisResult {
    // Fallback to simulation when OpenAI is unavailable
    logger.info(`Using fallback analysis for meeting ${meeting.id}`);

    return {
      meetingId: meeting.id,
      customerNeeds: {
        primary: '비용 절감',
        secondary: ['운영 효율화', '시스템 통합'],
        budget: '확인됨',
        timeline: '3개월 내',
        decisionMakers: 3,
        confidence: 0.85,
      },
      dealSignals: {
        signal: 'positive',
        strength: 8.0,
        closingProbability: 0.65,
        competition: 'none',
        nextSteps: '기술검토 일정 잡기',
      },
      scores: {
        customerUnderstanding: 82,
        problemSolving: 80,
        proposalPersuasion: 75,
        followUp: 72,
        teamCollaboration: 78,
        overall: 78,
      },
      sentiment: 'positive',
      keyPoints: ['고객 의사결정자 명확함', '경쟁사 없음', '예산 승인됨'],
      createdAt: new Date().toISOString(),
    };
  }
}
