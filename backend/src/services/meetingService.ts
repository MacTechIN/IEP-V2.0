import { v4 as uuidv4 } from 'uuid';
import type { Meeting, AnalysisResult } from '../types';
import { query, queryOne } from '../utils/database';
import { OpenAIService } from './openaiService';
import type { DiarizedSegment } from './openaiService';
import { logger } from '../utils/logger';

export class MeetingService {
  // Create meeting
  static async createMeeting(data: {
    userId: string;
    customerId: string;
    title: string;
    startTime: string;
    endTime: string;
    durationMinutes?: number;
    attendees?: any[];
    audioUrl?: string;
    notes?: string;
    autoAnalyze?: boolean;
  }): Promise<Meeting> {
    const meetingId = uuidv4();
    const now = new Date().toISOString();

    const result = await queryOne<any>(
      `INSERT INTO v2.meetings (id, user_id, customer_id, title, start_time, end_time, duration_minutes, audio_url, notes, analysis_status, analysis_progress, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, user_id, customer_id, title, start_time, end_time, duration_minutes, audio_url, notes, analysis_status, analysis_progress, created_at`,
      [
        meetingId,
        data.userId,
        data.customerId,
        data.title,
        data.startTime,
        data.endTime,
        data.durationMinutes || 0,
        data.audioUrl || null,
        data.notes || null,
        'pending',
        0,
        now,
        now,
      ]
    );

    // 녹음 목록 분석 흐름에서는 생성 즉시 분석하지 않음(중복/비용 방지)
    if (data.autoAnalyze !== false) {
      this.startAnalysis(meetingId);
    }

    return this.mapToMeeting(result);
  }

  // Get meetings for user
  static async getMeetings(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ meetings: Meeting[]; total: number }> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    const result = await query<any>(
      `SELECT m.id, m.user_id, m.customer_id, m.title, m.start_time, m.end_time, m.duration_minutes,
              m.audio_url, m.notes, m.analysis_status, m.analysis_progress, m.created_at,
              c.company_name, (a.scores->>'overall') AS overall_score
       FROM v2.meetings m
       LEFT JOIN v2.customers c ON m.customer_id = c.id
       LEFT JOIN v2.analysis_results a ON m.id = a.meeting_id
       WHERE m.user_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM v2.meetings WHERE user_id = $1 AND deleted_at IS NULL',
      [userId]
    );

    return {
      meetings: result.rows.map((r) => ({
        ...this.mapToMeeting(r),
        customerName: r.company_name || undefined,
        overallScore: r.overall_score != null ? parseInt(r.overall_score, 10) : undefined,
      })),
      total: parseInt(countResult?.count || '0', 10),
    };
  }

  // Get meeting by ID
  /**
   * 소유자(또는 관리자)에게만 돌려준다.
   *
   * 예전에는 ID 만 맞으면 **남의 미팅이라도 그대로 반환했다.** 고객 쪽과 같은 구멍인데
   * 이쪽이 더 무겁다 — 미팅에는 녹취 전문과 분석 결과가 들어 있다.
   * requesterId 를 넘기지 않으면 예전처럼 동작한다(내부 파이프라인 호출용). 라우트는 반드시 넘긴다.
   */
  static async getMeetingById(
    meetingId: string,
    requesterId?: string,
    isAdmin = false,
  ): Promise<Meeting | null> {
    const result = await queryOne<any>(
      `SELECT id, user_id, customer_id, title, start_time, end_time, duration_minutes, audio_url, audio_duration_seconds, transcription, notes, analysis_status, analysis_progress, created_at
       FROM v2.meetings
       WHERE id = $1 AND deleted_at IS NULL`,
      [meetingId]
    );

    if (!result) return null;
    // 없는 것과 권한 없는 것을 구분해 주지 않는다
    if (requesterId && !isAdmin && result.user_id !== requesterId) return null;
    return this.mapToMeeting(result);
  }

  // Update meeting
  static async updateMeeting(
    meetingId: string,
    data: Partial<Meeting>,
  ): Promise<Meeting | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.title) {
      updates.push(`title = $${paramCount++}`);
      values.push(data.title);
    }
    if (data.notes) {
      updates.push(`notes = $${paramCount++}`);
      values.push(data.notes);
    }
    if (data.analysisStatus) {
      updates.push(`analysis_status = $${paramCount++}`);
      values.push(data.analysisStatus);
    }
    if (data.analysisProgress !== undefined) {
      updates.push(`analysis_progress = $${paramCount++}`);
      values.push(Math.round(data.analysisProgress)); // 컬럼이 INTEGER — 소수 반올림
    }

    if (updates.length === 0) return this.getMeetingById(meetingId);

    updates.push(`updated_at = NOW()`);
    values.push(meetingId);

    await query(
      `UPDATE v2.meetings SET ${updates.join(', ')} WHERE id = $${paramCount} AND deleted_at IS NULL`,
      values
    );

    return this.getMeetingById(meetingId);
  }

  // Delete meeting (soft delete)
  static async deleteMeeting(meetingId: string): Promise<boolean> {
    const result = await query(
      `UPDATE v2.meetings SET deleted_at = NOW() WHERE id = $1`,
      [meetingId]
    );
    return result.rowCount > 0;
  }

  // Get analysis for meeting (existing fields + V1식 report fields)
  static async getAnalysis(meetingId: string): Promise<AnalysisResult | null> {
    const result = await queryOne<any>(
      `SELECT id, meeting_id, customer_needs, deal_signals, scores, sentiment, key_points,
              summary, interests, concerns, action_items, follow_up_draft, talk_metrics, speaker_roles,
              psych_insights, coaching, scorecard,
              created_at
       FROM v2.analysis_results
       WHERE meeting_id = $1`,
      [meetingId]
    );

    return result ? this.mapToAnalysis(result) : null;
  }

  // 화자별 전사 세그먼트 조회
  static async getSegments(meetingId: string): Promise<any[]> {
    const result = await query<any>(
      `SELECT id, meeting_id, speaker_label, speaker_id, content, start_ms, end_ms, sort_order
       FROM v2.transcript_segments WHERE meeting_id = $1 ORDER BY sort_order ASC`,
      [meetingId]
    );
    return result.rows.map((r) => ({
      id: r.id,
      meetingId: r.meeting_id,
      speakerLabel: r.speaker_label,
      speakerId: r.speaker_id,
      content: r.content,
      startMs: r.start_ms,
      endMs: r.end_ms,
      sortOrder: r.sort_order,
    }));
  }

  // Persist transcription text
  static async setTranscription(meetingId: string, text: string): Promise<void> {
    await query(
      `UPDATE v2.meetings SET transcription = $1, updated_at = NOW() WHERE id = $2`,
      [text, meetingId]
    );
  }

  // Persist uploaded audio reference
  static async setAudio(
    meetingId: string,
    audioUrl: string,
    durationSeconds?: number,
  ): Promise<Meeting | null> {
    await query(
      `UPDATE v2.meetings SET audio_url = $1, audio_duration_seconds = $2, updated_at = NOW() WHERE id = $3`,
      [audioUrl, durationSeconds ?? null, meetingId]
    );
    return this.getMeetingById(meetingId);
  }

  // Core: analyze a meeting (uses its transcription if present) and persist result
  private static async analyzeAndSave(meetingId: string): Promise<void> {
    const meeting = await this.getMeetingById(meetingId);
    if (!meeting) return;

    const analysis = await OpenAIService.analyzeMeeting(meeting, meeting.transcription);

    await query(
      `INSERT INTO v2.analysis_results (meeting_id, customer_needs, deal_signals, scores, sentiment, key_points)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (meeting_id) DO UPDATE SET
         customer_needs = $2, deal_signals = $3, scores = $4, sentiment = $5, key_points = $6, updated_at = NOW()`,
      [
        meetingId,
        JSON.stringify(analysis.customerNeeds),
        JSON.stringify(analysis.dealSignals),
        JSON.stringify(analysis.scores),
        analysis.sentiment,
        analysis.keyPoints,
      ]
    );

    await this.updateMeeting(meetingId, { analysisStatus: 'completed', analysisProgress: 100 });
    logger.info(`✓ Analysis completed for meeting ${meetingId}`);
  }

  // Progress ticker used while a background job runs
  private static startProgressTicker(meetingId: string): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const meeting = await this.getMeetingById(meetingId);
        if (!meeting || meeting.analysisStatus === 'completed' || meeting.analysisStatus === 'failed') {
          return;
        }
        const newProgress = Math.min(meeting.analysisProgress + Math.random() * 20, 95);
        await this.updateMeeting(meetingId, { analysisProgress: newProgress, analysisStatus: 'processing' });
      } catch (error) {
        logger.error('Analysis progress update error:', error);
      }
    }, 1500);
  }

  // Fire-and-forget analysis (used at meeting creation; metadata-only unless transcription exists)
  private static startAnalysis(meetingId: string) {
    const ticker = this.startProgressTicker(meetingId);
    setImmediate(async () => {
      try {
        logger.info(`Starting analysis for meeting ${meetingId}`);
        await this.analyzeAndSave(meetingId);
      } catch (error) {
        logger.error('Analysis error:', error);
        await this.updateMeeting(meetingId, { analysisStatus: 'failed' });
      } finally {
        clearInterval(ticker);
      }
    });
  }

  // Audio pipeline (V1식): STT+화자분리 -> 세그먼트/역할/대화지표 저장 -> 기존분석(대시보드) -> V1 리포트
  static async processAudio(meetingId: string, filePath: string): Promise<void> {
    await this.updateMeeting(meetingId, { analysisStatus: 'processing', analysisProgress: 10 });
    const ticker = this.startProgressTicker(meetingId);
    setImmediate(async () => {
      try {
        logger.info(`Processing audio for meeting ${meetingId}: ${filePath}`);
        const stt = await OpenAIService.transcribeAudio(filePath);

        let roles: Record<string, string> = {};
        if (stt && stt.text) {
          await this.setTranscription(meetingId, stt.text);
          roles = await OpenAIService.mapSpeakerRoles(stt.segments);
          await this.saveSegments(meetingId, stt.segments, roles);
          logger.info(`Transcription+segments saved for meeting ${meetingId}`);
        } else {
          logger.warn(`No transcription for ${meetingId} (no key or STT failed) — analyzing on metadata`);
        }

        // 1) 기존 분석(대시보드 점수용) — analysis_results row 생성
        await this.analyzeAndSave(meetingId);

        // 2) V1식 리포트 + 심리/코칭 + 스코어카드 (전사문이 있을 때)
        if (stt && stt.text) {
          await this.saveDeepAnalysis(meetingId, stt.text, stt.segments, roles);
        }
      } catch (error) {
        logger.error('processAudio error:', error);
        await this.updateMeeting(meetingId, { analysisStatus: 'failed' });
      } finally {
        clearInterval(ticker);
      }
    });
  }

  // 여러 녹음(선택분)의 전사문·세그먼트를 합쳐 분석 (녹음 목록 → 선택 분석)
  static async analyzeFromRecordings(
    meetingId: string,
    recordings: { transcription: string; segments: any[] }[],
  ): Promise<void> {
    await this.updateMeeting(meetingId, { analysisStatus: 'processing', analysisProgress: 15 });
    const ticker = this.startProgressTicker(meetingId);
    setImmediate(async () => {
      try {
        const combinedText = recordings.map((r) => r.transcription || '').filter(Boolean).join('\n\n');
        // 세그먼트는 이미 역할 라벨(영업대표/고객)로 저장돼 있으므로 그대로 이어붙임
        const allSegments: DiarizedSegment[] = [];
        for (const r of recordings) {
          for (const s of r.segments || []) {
            allSegments.push({ speaker: s.speaker, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text });
          }
        }
        const roles: Record<string, string> = {};
        allSegments.forEach((s) => { roles[s.speaker] = s.speaker; });

        if (combinedText) {
          await this.setTranscription(meetingId, combinedText);
          await this.saveSegments(meetingId, allSegments, roles);
        }
        await this.analyzeAndSave(meetingId);
        if (combinedText) {
          await this.saveDeepAnalysis(meetingId, combinedText, allSegments, roles);
        } else {
          // 전사문이 없으면 가짜 상세 대신 명확한 경고를 남긴다
          await query(
            `UPDATE v2.analysis_results SET summary = $2, updated_at = NOW() WHERE meeting_id = $1`,
            [meetingId, '⚠️ 분석된 녹음(전사문)이 없어 미팅 제목만으로 분석되었습니다. 녹음을 확인한 뒤 다시 분석하세요.']
          );
        }
      } catch (error) {
        logger.error('analyzeFromRecordings error:', error);
        await this.updateMeeting(meetingId, { analysisStatus: 'failed' });
      } finally {
        clearInterval(ticker);
      }
    });
  }

  // 화자별 세그먼트 저장 (역할 라벨 매핑)
  private static async saveSegments(
    meetingId: string,
    segments: DiarizedSegment[],
    roles: Record<string, string>,
  ): Promise<void> {
    await query('DELETE FROM v2.transcript_segments WHERE meeting_id = $1', [meetingId]);
    let order = 0;
    for (const seg of segments) {
      const label = roles[seg.speaker] || `화자 ${seg.speaker}`;
      await query(
        `INSERT INTO v2.transcript_segments (meeting_id, speaker_label, speaker_id, content, start_ms, end_ms, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [meetingId, label, seg.speaker, seg.text, seg.start_ms, seg.end_ms, order++]
      );
    }
  }

  // V1식 리포트 + 대화지표 저장 (analyzeAndSave 이후 UPDATE)
  private static async saveReport(
    meetingId: string,
    report: any | null,
    talkMetrics: any,
    roles: Record<string, string>,
    psych?: any | null,
    scorecard?: any | null,
  ): Promise<void> {
    await query(
      `UPDATE v2.analysis_results SET
         summary = $2, interests = $3, concerns = $4, action_items = $5,
         follow_up_draft = $6, talk_metrics = $7, speaker_roles = $8,
         psych_insights = $9, coaching = $10, scorecard = $11, updated_at = NOW()
       WHERE meeting_id = $1`,
      [
        meetingId,
        report?.summary || null,
        JSON.stringify(report?.interests || []),
        JSON.stringify(report?.concerns || []),
        JSON.stringify(report?.action_items || []),
        report?.follow_up_draft || null,
        talkMetrics ? JSON.stringify(talkMetrics) : null,
        JSON.stringify(roles),
        psych ? JSON.stringify(psych.psych_insights) : null,
        psych ? JSON.stringify(psych.coaching) : null,
        scorecard ? JSON.stringify(scorecard) : null,
      ]
    );
    logger.info(`✓ Report+coaching+scorecard saved for meeting ${meetingId}`);
  }

  // 이전 미팅 맥락 (같은 고객 최근 2건 요약)
  static async fetchPreviousContext(meetingId: string): Promise<string | undefined> {
    const cur = await queryOne<any>('SELECT customer_id FROM v2.meetings WHERE id = $1', [meetingId]);
    if (!cur?.customer_id) return undefined;
    const rows = (
      await query<any>(
        `SELECT a.summary
         FROM v2.meetings m JOIN v2.analysis_results a ON m.id = a.meeting_id
         WHERE m.customer_id = $1 AND m.id <> $2 AND m.deleted_at IS NULL AND a.summary IS NOT NULL
         ORDER BY m.created_at DESC LIMIT 2`,
        [cur.customer_id, meetingId]
      )
    ).rows;
    if (!rows.length) return undefined;
    return rows.map((r, i) => `(이전 미팅 ${i + 1}) ${String(r.summary).slice(0, 500)}`).join('\n');
  }

  // 리포트 + 심리/코칭 + 스코어카드 생성·저장 (이전 맥락 주입). 세 LLM 호출 병렬.
  private static async saveDeepAnalysis(
    meetingId: string,
    text: string,
    segments: DiarizedSegment[],
    roles: Record<string, string>,
  ): Promise<void> {
    const meeting = await this.getMeetingById(meetingId);
    if (!meeting) return;
    const talkMetrics = this.computeTalkMetrics(segments, roles);
    const prevCtx = await this.fetchPreviousContext(meetingId);
    const [report, psych, scorecard] = await Promise.all([
      OpenAIService.generateReport(meeting, text, prevCtx),
      OpenAIService.generatePsychCoaching(meeting, text, talkMetrics, prevCtx),
      OpenAIService.generateScorecard(meeting, text),
    ]);
    await this.saveReport(meetingId, report, talkMetrics, roles, psych, scorecard);
  }

  // 대화 지표(코드 계산): 역할별 발화수/턴/질문/발화시간/발화비율/WPM
  private static computeTalkMetrics(segments: DiarizedSegment[], roles: Record<string, string>): any {
    const byLabel: Record<string, { words: number; turns: number; questions: number; talkMs: number }> = {};
    let totalMs = 0;
    let maxEnd = 0;
    for (const seg of segments) {
      const label = roles[seg.speaker] || `화자 ${seg.speaker}`;
      if (!byLabel[label]) byLabel[label] = { words: 0, turns: 0, questions: 0, talkMs: 0 };
      const words = seg.text.trim() ? seg.text.trim().split(/\s+/).length : 0;
      const ms = Math.max(0, (seg.end_ms || 0) - (seg.start_ms || 0));
      byLabel[label].words += words;
      byLabel[label].turns += 1;
      byLabel[label].questions += (seg.text.match(/\?|까\?|나요|가요/g) || []).length ? 1 : 0;
      byLabel[label].talkMs += ms;
      totalMs += ms;
      if ((seg.end_ms || 0) > maxEnd) maxEnd = seg.end_ms || 0;
    }
    const totalWords = Object.values(byLabel).reduce((a, b) => a + b.words, 0) || 1;
    const speakers: Record<string, any> = {};
    for (const [label, m] of Object.entries(byLabel)) {
      const talkRatio = totalMs > 0 ? m.talkMs / totalMs : m.words / totalWords;
      const wpm = m.talkMs > 0 ? Math.round(m.words / (m.talkMs / 60000)) : 0;
      speakers[label] = {
        words: m.words,
        turns: m.turns,
        questions: m.questions,
        talkMs: m.talkMs,
        talkRatio: Math.round(talkRatio * 100) / 100,
        wpm,
      };
    }
    return { durationMs: maxEnd, speakers };
  }

  private static mapToMeeting(row: any): Meeting {
    return {
      id: row.id,
      userId: row.user_id,
      customerId: row.customer_id,
      title: row.title,
      startTime: row.start_time,
      endTime: row.end_time,
      durationMinutes: row.duration_minutes || 0,
      audioUrl: row.audio_url,
      transcription: row.transcription,
      notes: row.notes,
      analysisStatus: row.analysis_status,
      analysisProgress: row.analysis_progress,
      createdAt: row.created_at,
    };
  }

  private static mapToAnalysis(row: any): AnalysisResult {
    return {
      meetingId: row.meeting_id,
      customerNeeds: row.customer_needs,
      dealSignals: row.deal_signals,
      scores: row.scores,
      sentiment: row.sentiment,
      keyPoints: row.key_points,
      // V1식 리포트
      summary: row.summary || undefined,
      interests: row.interests || undefined,
      concerns: row.concerns || undefined,
      actionItems: row.action_items || undefined,
      followUpDraft: row.follow_up_draft || undefined,
      talkMetrics: row.talk_metrics || undefined,
      speakerRoles: row.speaker_roles || undefined,
      psychInsights: row.psych_insights || undefined,
      coaching: row.coaching || undefined,
      scorecard: row.scorecard || undefined,
      createdAt: row.created_at,
    };
  }
}
