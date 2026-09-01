import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type { User, AuthResponse, JwtPayload } from '../types';
import { query, queryOne } from '../utils/database';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRE_IN = process.env.JWT_EXPIRE_IN || '3600';
const JWT_REFRESH_EXPIRE_IN = process.env.JWT_REFRESH_EXPIRE_IN || '2592000';

export class AuthService {
  // Login with email and password
  static async login(email: string, password: string): Promise<AuthResponse> {
    // Find user in database
    const user = await queryOne<any>(
      'SELECT id, email, name, password_hash, role, department, monthly_target_krw, created_at, updated_at FROM v2.users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (!user) {
      throw new Error('User not found');
    }

    // Verify password
    const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error('Invalid password');
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email, user.role);

    // Create session in database
    const expiresAt = new Date(Date.now() + parseInt(JWT_REFRESH_EXPIRE_IN) * 1000);
    await query(
      'INSERT INTO v2.sessions (user_id, refresh_token, is_active, expires_at) VALUES ($1, $2, $3, $4)',
      [user.id, tokens.refreshToken, true, expiresAt]
    );

    // Update last login
    await query('UPDATE v2.users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const { password_hash, ...userWithoutPassword } = user;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: userWithoutPassword.id,
        email: userWithoutPassword.email,
        name: userWithoutPassword.name,
        role: userWithoutPassword.role,
        department: userWithoutPassword.department,
        monthlyTargetKrw: userWithoutPassword.monthly_target_krw,
        createdAt: userWithoutPassword.created_at,
        updatedAt: userWithoutPassword.updated_at,
      } as User,
      expiresIn: parseInt(JWT_EXPIRE_IN),
    };
  }

  // Refresh access token
  static async refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    // Verify token is valid
    let payload: JwtPayload;
    try {
      payload = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload;
    } catch {
      throw new Error('Invalid refresh token');
    }

    // Check session in database
    const session = await queryOne<any>(
      'SELECT id, user_id, expires_at FROM v2.sessions WHERE refresh_token = $1 AND is_active = true',
      [refreshToken]
    );

    if (!session) {
      throw new Error('Session not found');
    }

    if (new Date(session.expires_at) < new Date()) {
      // Revoke expired session
      await query('UPDATE v2.sessions SET is_active = false, revoked_at = NOW() WHERE id = $1', [session.id]);
      throw new Error('Refresh token expired');
    }

    // Generate new access token
    const signOptions: SignOptions = { expiresIn: parseInt(JWT_EXPIRE_IN) };
    const newAccessToken = jwt.sign(
      {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      },
      JWT_SECRET,
      signOptions,
    );

    return {
      accessToken: newAccessToken,
      expiresIn: parseInt(JWT_EXPIRE_IN),
    };
  }

  // Generate JWT tokens
  private static generateTokens(
    userId: string,
    email: string,
    role: string,
  ): { accessToken: string; refreshToken: string } {
    const payload = {
      sub: userId,
      email,
      role,
    };

    const accessSignOptions: SignOptions = { expiresIn: parseInt(JWT_EXPIRE_IN) };
    const refreshSignOptions: SignOptions = { expiresIn: parseInt(JWT_REFRESH_EXPIRE_IN) };
    const accessToken = jwt.sign(payload, JWT_SECRET, accessSignOptions);
    const refreshToken = jwt.sign(payload, JWT_SECRET, refreshSignOptions);

    return { accessToken, refreshToken };
  }

  // Verify JWT token
  static verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Get user by ID
  static async getUserById(userId: string): Promise<User | null> {
    const user = await queryOne<any>(
      'SELECT id, email, name, role, department, monthly_target_krw, created_at, updated_at FROM v2.users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      monthlyTargetKrw: user.monthly_target_krw,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  // Create a user with an explicit role (used by admin). Default role: 'user'.
  static async createUser(
    email: string,
    name: string,
    password: string,
    role: string = 'user',
  ): Promise<User> {
    const existing = await queryOne('SELECT id FROM v2.users WHERE email = $1', [email]);
    if (existing) {
      throw new Error('Email already exists');
    }

    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);

    await query(
      `INSERT INTO v2.users (id, email, name, password_hash, role, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, name, passwordHash, role, true]
    );

    return this.getUserById(userId) as Promise<User>;
  }

  // Register (public-style) — regular user role
  static async register(email: string, name: string, password: string): Promise<User> {
    return this.createUser(email, name, password, 'user');
  }

  // List all users (admin)
  static async listUsers(): Promise<User[]> {
    const result = await query<any>(
      `SELECT id, email, name, role, department, monthly_target_krw, is_active, last_login_at, created_at, updated_at
       FROM v2.users ORDER BY created_at ASC`
    );
    return result.rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      department: u.department,
      monthlyTargetKrw: u.monthly_target_krw,
      isActive: u.is_active,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    }));
  }

  // Activate/deactivate a user (admin)
  static async setUserActive(userId: string, isActive: boolean): Promise<void> {
    await query('UPDATE v2.users SET is_active = $1, updated_at = NOW() WHERE id = $2', [isActive, userId]);
  }

  // Update user
  static async updateUser(userId: string, data: Partial<User>): Promise<User | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.name) {
      updates.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.department) {
      updates.push(`department = $${paramCount++}`);
      values.push(data.department);
    }
    if (data.monthlyTargetKrw) {
      updates.push(`monthly_target_krw = $${paramCount++}`);
      values.push(data.monthlyTargetKrw);
    }

    if (updates.length === 0) return this.getUserById(userId);

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    await query(`UPDATE v2.users SET ${updates.join(', ')} WHERE id = $${paramCount}`, values);

    return this.getUserById(userId);
  }
}
