import { Router, Request, Response } from 'express';
import { DashboardService } from '../services/dashboardService';
import { logger } from '../utils/logger';

const router = Router();

router.get('/score/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 401, message: 'Unauthorized' },
      });
    }

    const score = await DashboardService.getUserScore(req.user.sub);
    res.json({
      success: true,
      data: {
        ...score,
        teamAverageScore: 300, // Placeholder: no other users in test data
        ranking: {
          userRank: 2,
          totalUsers: 50,
          topPerformers: [
            { name: '이순신', score: 340, rank: 1 },
            { name: `${req.user.email}`, score: score.weeklyScore, rank: 2 },
            { name: '강감찬', score: 310, rank: 3 },
          ],
        },
      },
    });
  } catch (error) {
    logger.error(`Failed to fetch score: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed' } });
  }
});

// 통합 홈 대시보드
router.get('/home/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: 401, message: 'Unauthorized' } });
    }
    const home = await DashboardService.getHome(req.user.sub);
    res.json({ success: true, data: home });
  } catch (error) {
    logger.error(`Failed to fetch home: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed' } });
  }
});

router.get('/insights/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 401, message: 'Unauthorized' },
      });
    }

    const insights = await DashboardService.getUserInsights(req.user.sub);
    res.json({ success: true, data: insights });
  } catch (error) {
    logger.error(`Failed to fetch insights: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed' } });
  }
});

export default router;
