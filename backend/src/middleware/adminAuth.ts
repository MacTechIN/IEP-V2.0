import { Request, Response, NextFunction } from 'express';

// Requires an authenticated admin (must run AFTER authMiddleware).
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: { code: 403, message: 'Admin privileges required' },
    });
  }
  next();
};
