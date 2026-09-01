import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email: string;
        role: string;
      };
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 401,
          message: 'Missing or invalid authorization header',
        },
      });
    }

    const token = authHeader.substring(7);
    const payload = AuthService.verifyToken(token);

    req.user = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (error) {
    logger.error(`Auth middleware error: ${error}`);
    res.status(401).json({
      success: false,
      error: {
        code: 401,
        message: 'Invalid token',
      },
    });
  }
};
