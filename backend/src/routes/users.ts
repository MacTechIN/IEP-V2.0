import { Router, Request, Response } from 'express';
import { UserService } from '../services/userService';
import { logger } from '../utils/logger';

const router = Router();

// GET /users/me - get current user
router.get('/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 401, message: 'Unauthorized' },
      });
    }

    const user = await UserService.getUserById(req.user.sub);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'User not found' },
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    logger.error(`Failed to fetch user: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch user' },
    });
  }
});

// PATCH /users/me - update current user
router.patch('/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 401, message: 'Unauthorized' },
      });
    }

    const user = await UserService.updateUser(req.user.sub, req.body);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'User not found' },
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    logger.error(`Failed to update user: ${error}`);
    res.status(400).json({
      success: false,
      error: { code: 400, message: 'Failed to update user' },
    });
  }
});

export default router;
