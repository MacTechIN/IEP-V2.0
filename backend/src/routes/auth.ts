import { Router, Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { logger } from '../utils/logger';

const router = Router();

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 400, message: 'Email and password are required' },
      });
    }

    logger.info(`Login attempt: ${email}`);

    const authResponse = await AuthService.login(email, password);

    logger.info(`Login successful: ${email}`);

    res.json({
      success: true,
      data: authResponse,
    });
  } catch (error) {
    // **실패 이유를 응답에 싣지 않는다.**
    // 예전에는 details.error 에 'User not found' 와 'Invalid password' 가 그대로 나갔다.
    // 화면에 쓰이지도 않으면서, 그것만으로 **어떤 이메일이 가입돼 있는지 확인할 수 있었다.**
    // 이유는 로그에만 남긴다.
    logger.error(`Login error: ${error}`);
    res.status(401).json({
      success: false,
      error: { code: 401, message: 'Authentication failed' },
    });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: { code: 400, message: 'Refresh token is required' },
      });
    }

    const result = await AuthService.refresh(refreshToken);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Refresh error: ${error}`);
    res.status(401).json({
      success: false,
      error: { code: 401, message: 'Token refresh failed' },
    });
  }
});

// POST /auth/logout
router.post('/logout', (req: Request, res: Response) => {
  // TODO: 세션 무효화 로직
  logger.info('Logout');
  res.json({
    success: true,
    data: { message: '로그아웃 완료' },
  });
});

export default router;
