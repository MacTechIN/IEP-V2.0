import { AuthService } from './authService';
import type { User } from '../types';

export class UserService {
  static async getUserById(userId: string): Promise<User | null> {
    return AuthService.getUserById(userId);
  }

  static async updateUser(
    userId: string,
    data: { name?: string; department?: string; monthlyTargetKrw?: number },
  ): Promise<User | null> {
    // Persists to PostgreSQL via AuthService
    return AuthService.updateUser(userId, data);
  }

  // --- Admin operations ---
  static async listUsers(): Promise<User[]> {
    return AuthService.listUsers();
  }

  static async createUser(
    email: string,
    name: string,
    password: string,
    role: string = 'user',
  ): Promise<User> {
    return AuthService.createUser(email, name, password, role);
  }

  static async setActive(userId: string, isActive: boolean): Promise<void> {
    return AuthService.setUserActive(userId, isActive);
  }
}
