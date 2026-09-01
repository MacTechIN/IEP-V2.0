import { Router, Request, Response } from 'express';
import { MeetingService } from '../services/meetingService';
import { ActionService } from '../services/actionService';
import { logger } from '../utils/logger';

const router = Router();

// GET /analytics/summary - Get user summary stats
router.get('/summary', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 401, message: 'Unauthorized' },
      });
    }

    const { meetings, total: totalMeetings } = await MeetingService.getMeetings(
      req.user.sub,
      { limit: 1000 },
    );

    const completedMeetings = meetings.filter((m) => m.analysisStatus === 'completed');
    const processingMeetings = meetings.filter((m) => m.analysisStatus === 'processing');
    const pendingMeetings = meetings.filter((m) => m.analysisStatus === 'pending');

    const avgAnalysisTime =
      completedMeetings.length > 0
        ? Math.round(
            completedMeetings.reduce(
              (sum, m) => sum + (new Date(m.createdAt).getTime() / 1000),
              0,
            ) / completedMeetings.length,
          )
        : 0;

    res.json({
      success: true,
      data: {
        userId: req.user.sub,
        totalMeetings,
        completedMeetings: completedMeetings.length,
        processingMeetings: processingMeetings.length,
        pendingMeetings: pendingMeetings.length,
        completionRate:
          totalMeetings > 0
            ? Math.round((completedMeetings.length / totalMeetings) * 100)
            : 0,
        avgAnalysisTime,
        firstMeetingDate: meetings.length > 0 ? meetings[meetings.length - 1].createdAt : null,
        lastMeetingDate: meetings.length > 0 ? meetings[0].createdAt : null,
      },
    });
  } catch (error) {
    logger.error(`Failed to fetch analytics: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch analytics' },
    });
  }
});

// GET /analytics/trends - Get trend data for charts
router.get('/trends', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 401, message: 'Unauthorized' },
      });
    }

    const { meetings } = await MeetingService.getMeetings(req.user.sub, { limit: 1000 });

    // Group by week and calculate metrics
    const trends = meetings.reduce(
      (acc: any, meeting) => {
        const week = Math.floor(
          (Date.now() - new Date(meeting.createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000),
        );
        if (!acc[week]) {
          acc[week] = { week, count: 0, completed: 0 };
        }
        acc[week].count++;
        if (meeting.analysisStatus === 'completed') {
          acc[week].completed++;
        }
        return acc;
      },
      {},
    );

    res.json({
      success: true,
      data: Object.values(trends).slice(0, 12), // Last 12 weeks
    });
  } catch (error) {
    logger.error(`Failed to fetch trends: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch trends' },
    });
  }
});

export default router;
