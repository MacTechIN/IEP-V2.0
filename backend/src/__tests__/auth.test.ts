import { AuthService } from '../services/authService';

describe('AuthService', () => {
  it('should login with correct credentials', async () => {
    const result = await AuthService.login('kim@company.com', 'password123');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe('kim@company.com');
    expect(result.expiresIn).toBeDefined();
  });

  it('should throw on wrong password', async () => {
    try {
      await AuthService.login('kim@company.com', 'wrongpassword');
      fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('Invalid password');
    }
  });

  it('should throw on non-existent user', async () => {
    try {
      await AuthService.login('nonexistent@company.com', 'password123');
      fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('User not found');
    }
  });

  it('should verify valid token', () => {
    const token = require('jsonwebtoken').sign(
      { sub: 'user-123', email: 'kim@company.com', role: 'sales_rep' },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    );

    const payload = AuthService.verifyToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('kim@company.com');
  });

  it('should throw on invalid token', () => {
    try {
      AuthService.verifyToken('invalid.token.here');
      fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('Invalid token');
    }
  });
});
