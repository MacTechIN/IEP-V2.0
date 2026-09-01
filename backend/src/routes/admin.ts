import { Router, Request, Response } from 'express';
import { UserService } from '../services/userService';
import { logger } from '../utils/logger';

const router = Router();

// GET /admin/users - 전체 사용자 목록 (관리자)
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await UserService.listUsers();
    res.json({ success: true, data: users, meta: { total: users.length } });
  } catch (error) {
    logger.error(`Failed to list users: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed to list users' } });
  }
});

// POST /admin/users - 사용자 생성 (관리자)
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, name, password, role } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 400, message: 'email, name, password are required' },
      });
    }
    const allowedRole = role === 'admin' ? 'admin' : 'user';
    const user = await UserService.createUser(email, name, password, allowedRole);
    logger.info(`Admin created user: ${user.id} (${email}, ${allowedRole})`);
    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    const msg = error?.message === 'Email already exists' ? error.message : 'Failed to create user';
    logger.error(`Failed to create user: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: msg } });
  }
});

// PATCH /admin/users/:id - 사용자 활성/비활성 (관리자)
router.patch('/users/:id', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { code: 400, message: 'isActive (boolean) is required' },
      });
    }
    // 자기 자신 비활성화 방지
    if (req.params.id === req.user?.sub && isActive === false) {
      return res.status(400).json({
        success: false,
        error: { code: 400, message: 'Cannot deactivate your own account' },
      });
    }
    await UserService.setActive(req.params.id, isActive);
    logger.info(`Admin set user ${req.params.id} active=${isActive}`);
    res.json({ success: true, data: { id: req.params.id, isActive } });
  } catch (error) {
    logger.error(`Failed to update user: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Failed to update user' } });
  }
});

export default router;
