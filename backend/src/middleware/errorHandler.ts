import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error(`Error: ${err.message}`);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code || err.statusCode,
        message: err.message,
        details: err.details,
      },
    });
  }

  res.status(500).json({
    success: false,
    error: {
      code: 500,
      message: 'Internal Server Error',
    },
  });
};

export { AppError };
