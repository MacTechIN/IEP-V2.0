import { v4 as uuidv4 } from 'uuid';
import type { Customer } from '../types';
import { query, queryOne } from '../utils/database';

export class CustomerService {
  static async createCustomer(data: {
    userId: string;
    companyName: string;
    industry?: string;
    companySize?: string;
    budgetMinKrw?: number;
    budgetMaxKrw?: number;
    primaryContactName?: string;
    primaryContactEmail?: string;
  }): Promise<Customer> {
    const customerId = uuidv4();
    const now = new Date().toISOString();

    const result = await queryOne<any>(
      `INSERT INTO v2.customers (id, user_id, company_name, industry, company_size, budget_min_krw, budget_max_krw, deal_status, primary_contact_name, primary_contact_email, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, user_id, company_name, industry, company_size, budget_min_krw, budget_max_krw, deal_status, primary_contact_name, primary_contact_email, created_at, updated_at`,
      [
        customerId,
        data.userId,
        data.companyName,
        data.industry || null,
        data.companySize || null,
        data.budgetMinKrw || null,
        data.budgetMaxKrw || null,
        'new',
        data.primaryContactName || null,
        data.primaryContactEmail || null,
        now,
        now,
      ]
    );

    return this.mapToCustomer(result);
  }

  static async getCustomers(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ customers: Customer[]; total: number }> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    const result = await query<any>(
      `SELECT id, user_id, company_name, industry, company_size, budget_min_krw, budget_max_krw, deal_status, primary_contact_name, primary_contact_email, created_at, updated_at, notes
       FROM v2.customers
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM v2.customers WHERE user_id = $1 AND deleted_at IS NULL',
      [userId]
    );

    return {
      customers: result.rows.map(this.mapToCustomer),
      total: parseInt(countResult?.count || '0', 10),
    };
  }

  /**
   * 소유자(또는 관리자)에게만 돌려준다.
   *
   * 예전에는 ID 만 맞으면 **남의 고객이라도 그대로 반환했다.** 목록은 user_id 로 걸러내는데
   * 단건 조회·수정·삭제는 걸러내지 않아, 목록에 없는 것을 ID 로 읽고 고칠 수 있었다.
   * 2026-08-08 에 실제 계정 둘로 재현했다 — 남의 고객 이름이 그대로 나왔고 notes 수정도 통했다.
   *
   * requesterId 를 넘기지 않으면 예전처럼 동작한다(내부 호출용). 라우트는 반드시 넘긴다.
   */
  static async getCustomerById(
    customerId: string,
    requesterId?: string,
    isAdmin = false,
  ): Promise<Customer | null> {
    const result = await queryOne<any>(
      `SELECT id, user_id, company_name, industry, company_size, budget_min_krw, budget_max_krw, deal_status, primary_contact_name, primary_contact_email, created_at, updated_at, notes
       FROM v2.customers
       WHERE id = $1 AND deleted_at IS NULL`,
      [customerId]
    );

    if (!result) return null;
    // 없는 것과 권한 없는 것을 구분해 주지 않는다 — 존재 여부 자체가 정보다
    if (requesterId && !isAdmin && result.user_id !== requesterId) return null;
    return this.mapToCustomer(result);
  }

  static async updateCustomer(
    customerId: string,
    data: Partial<Customer>,
  ): Promise<Customer | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.companyName) {
      updates.push(`company_name = $${paramCount++}`);
      values.push(data.companyName);
    }
    if (data.industry) {
      updates.push(`industry = $${paramCount++}`);
      values.push(data.industry);
    }
    if (data.dealStatus) {
      updates.push(`deal_status = $${paramCount++}`);
      values.push(data.dealStatus);
    }
    if (data.notes) {
      updates.push(`notes = $${paramCount++}`);
      values.push(data.notes);
    }

    if (updates.length === 0) return this.getCustomerById(customerId);

    updates.push(`updated_at = NOW()`);
    values.push(customerId);

    await query(
      `UPDATE v2.customers SET ${updates.join(', ')} WHERE id = $${paramCount} AND deleted_at IS NULL`,
      values
    );

    return this.getCustomerById(customerId);
  }

  static async deleteCustomer(customerId: string): Promise<boolean> {
    const result = await query(
      `UPDATE v2.customers SET deleted_at = NOW() WHERE id = $1`,
      [customerId]
    );
    return result.rowCount > 0;
  }

  private static mapToCustomer(row: any): Customer {
    return {
      id: row.id,
      userId: row.user_id,
      companyName: row.company_name,
      industry: row.industry,
      companySize: row.company_size,
      budgetMinKrw: row.budget_min_krw,
      budgetMaxKrw: row.budget_max_krw,
      dealStatus: row.deal_status,
      primaryContactName: row.primary_contact_name,
      primaryContactEmail: row.primary_contact_email,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
