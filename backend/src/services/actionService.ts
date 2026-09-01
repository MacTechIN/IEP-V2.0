import { v4 as uuidv4 } from 'uuid';
import type { ActionItem } from '../types';
import { query, queryOne } from '../utils/database';

export class ActionService {
  static async createAction(data: {
    meetingId: string;
    actionText: string;
    priority?: string;
    dueDate: string;
    assignedToUserId?: string;
  }): Promise<ActionItem> {
    const actionId = uuidv4();
    const now = new Date().toISOString();

    const result = await queryOne<any>(
      `INSERT INTO v2.action_items (id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at`,
      [
        actionId,
        data.meetingId,
        data.actionText,
        data.priority || 'medium',
        data.dueDate,
        data.assignedToUserId || null,
        'pending',
        now,
        now,
      ]
    );

    return this.mapToAction(result);
  }

  static async getActions(options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<{ actions: ActionItem[]; total: number }> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    let query_sql = `SELECT id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at
                      FROM v2.action_items`;
    const values: any[] = [];

    if (options?.status) {
      query_sql += ` WHERE status = $${values.length + 1}`;
      values.push(options.status);
    }

    query_sql += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await query<any>(query_sql, values);

    const countQuery = options?.status
      ? 'SELECT COUNT(*) as count FROM v2.action_items WHERE status = $1'
      : 'SELECT COUNT(*) as count FROM v2.action_items';

    const countResult = await queryOne<{ count: string }>(
      countQuery,
      options?.status ? [options.status] : []
    );

    return {
      actions: result.rows.map(this.mapToAction),
      total: parseInt(countResult?.count || '0', 10),
    };
  }

  static async updateAction(
    actionId: string,
    data: Partial<ActionItem>,
  ): Promise<ActionItem | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.actionText) {
      updates.push(`action_text = $${paramCount++}`);
      values.push(data.actionText);
    }
    if (data.priority) {
      updates.push(`priority = $${paramCount++}`);
      values.push(data.priority);
    }
    if (data.status) {
      updates.push(`status = $${paramCount++}`);
      values.push(data.status);

      if (data.status === 'completed') {
        updates.push(`completed_at = NOW()`);
      }
    }
    if (data.dueDate) {
      updates.push(`due_date = $${paramCount++}`);
      values.push(data.dueDate);
    }

    if (updates.length === 0) {
      const result = await queryOne<any>(
        `SELECT id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at
         FROM v2.action_items WHERE id = $1`,
        [actionId]
      );
      return result ? this.mapToAction(result) : null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(actionId);

    await query(
      `UPDATE v2.action_items SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    const result = await queryOne<any>(
      `SELECT id, meeting_id, action_text, priority, due_date, assigned_to_user_id, status, created_at, updated_at
       FROM v2.action_items WHERE id = $1`,
      [actionId]
    );

    return result ? this.mapToAction(result) : null;
  }

  static async deleteAction(actionId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM v2.action_items WHERE id = $1',
      [actionId]
    );
    return result.rowCount > 0;
  }

  private static mapToAction(row: any): ActionItem {
    return {
      id: row.id,
      meetingId: row.meeting_id,
      actionText: row.action_text,
      priority: row.priority,
      dueDate: row.due_date,
      assignedToUserId: row.assigned_to_user_id,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
