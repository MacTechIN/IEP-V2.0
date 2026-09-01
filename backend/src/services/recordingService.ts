import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { query, queryOne } from '../utils/database';
import { OpenAIService } from './openaiService';
import { logger } from '../utils/logger';

// 미팅당 다중 녹음: 각 녹음을 개별 저장·개별 전사(화자 역할 라벨 포함)
export class RecordingService {
  // 녹음 1건 업로드 → STT → 역할 라벨 세그먼트 저장 (meeting_id 없이 draft)
  static async createDraft(
    userId: string,
    filePath: string,
    label: string | null,
    durationSeconds: number | null,
  ): Promise<any> {
    let transcription = '';
    let segments: any[] = [];

    const stt = await OpenAIService.transcribeAudio(filePath);
    if (stt && stt.text) {
      transcription = stt.text;
      const roles = await OpenAIService.mapSpeakerRoles(stt.segments);
      segments = stt.segments.map((s) => ({
        speaker: roles[s.speaker] || `화자 ${s.speaker}`,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        text: s.text,
      }));
    }

    // sort_order = 현재 draft 개수
    const cnt = await queryOne<{ count: string }>(
      'SELECT COUNT(*) AS count FROM v2.meeting_recordings WHERE user_id = $1 AND meeting_id IS NULL',
      [userId]
    );
    const sortOrder = parseInt(cnt?.count || '0', 10);
    const id = uuidv4();

    const row = await queryOne<any>(
      `INSERT INTO v2.meeting_recordings
         (id, user_id, label, storage_path, duration_seconds, transcription, segments, selected, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
       RETURNING id, label, duration_seconds, transcription, selected, sort_order`,
      [
        id, userId,
        label || `녹음 ${sortOrder + 1}`,
        filePath, durationSeconds || null,
        transcription, JSON.stringify(segments), sortOrder,
      ]
    );

    logger.info(`Draft recording ${id} created (${transcription.length} chars)`);
    return this.map(row);
  }

  static async listDrafts(userId: string): Promise<any[]> {
    const res = await query<any>(
      `SELECT id, label, duration_seconds, transcription, selected, sort_order
       FROM v2.meeting_recordings
       WHERE user_id = $1 AND meeting_id IS NULL
       ORDER BY sort_order ASC`,
      [userId]
    );
    return res.rows.map(this.map);
  }

  static async update(id: string, userId: string, data: { label?: string; selected?: boolean }): Promise<any | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let p = 1;
    if (typeof data.label === 'string') { updates.push(`label = $${p++}`); values.push(data.label); }
    if (typeof data.selected === 'boolean') { updates.push(`selected = $${p++}`); values.push(data.selected); }
    if (updates.length === 0) return null;
    values.push(id, userId);
    await query(
      `UPDATE v2.meeting_recordings SET ${updates.join(', ')} WHERE id = $${p} AND user_id = $${p + 1}`,
      values
    );
    const row = await queryOne<any>(
      `SELECT id, label, duration_seconds, transcription, selected, sort_order
       FROM v2.meeting_recordings WHERE id = $1`, [id]
    );
    return row ? this.map(row) : null;
  }

  static async remove(id: string, userId: string): Promise<boolean> {
    const row = await queryOne<any>(
      'SELECT storage_path FROM v2.meeting_recordings WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!row) return false;
    const res = await query('DELETE FROM v2.meeting_recordings WHERE id = $1 AND user_id = $2', [id, userId]);
    if (row.storage_path) {
      try { fs.unlinkSync(row.storage_path); } catch { /* ignore */ }
    }
    return res.rowCount > 0;
  }

  // 선택된 녹음을 미팅에 첨부하고, 전사문/세그먼트를 반환
  static async attach(
    meetingId: string,
    recordingIds: string[],
    userId: string,
  ): Promise<{ transcription: string; segments: any[] }[]> {
    if (!recordingIds.length) return [];
    const rows = (
      await query<any>(
        `SELECT id, transcription, segments FROM v2.meeting_recordings
         WHERE id = ANY($1) AND user_id = $2
         ORDER BY sort_order ASC`,
        [recordingIds, userId]
      )
    ).rows;
    await query(
      `UPDATE v2.meeting_recordings SET meeting_id = $1 WHERE id = ANY($2) AND user_id = $3`,
      [meetingId, recordingIds, userId]
    );
    return rows.map((r) => ({ transcription: r.transcription || '', segments: r.segments || [] }));
  }

  private static map(row: any) {
    return {
      id: row.id,
      label: row.label,
      durationSeconds: row.duration_seconds,
      transcription: row.transcription,
      transcriptPreview: row.transcription ? String(row.transcription).slice(0, 160) : '',
      selected: row.selected,
      sortOrder: row.sort_order,
    };
  }
}
