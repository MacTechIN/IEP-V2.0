import { Router, Request, Response } from 'express';
import { MeetingService } from '../services/meetingService';
import { logger } from '../utils/logger';

const router = Router();

// GET /analysis/meeting/:meetingId - 분석 결과 조회
router.get('/meeting/:meetingId', async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;

    const meeting = await MeetingService.getMeetingById(
      meetingId, req.user!.sub, req.user!.role === 'admin');
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'Meeting not found' },
      });
    }

    const analysis = await MeetingService.getAnalysis(meetingId);
    if (!analysis) {
      return res.status(202).json({
        success: true,
        data: {
          meetingId,
          status: meeting.analysisStatus,
          progress: meeting.analysisProgress,
          message: '분석이 진행 중입니다',
        },
      });
    }

    res.json({ success: true, data: analysis });
  } catch (error) {
    logger.error(`Failed to fetch analysis: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch analysis' },
    });
  }
});

// GET /analysis/meeting/:meetingId/transcript - 화자별 전사 세그먼트
router.get('/meeting/:meetingId/transcript', async (req: Request, res: Response) => {
  try {
    // 남의 미팅 녹취 전문을 ID 만으로 읽을 수 있었다. 소유 확인을 먼저 한다.
    const owned = await MeetingService.getMeetingById(
      req.params.meetingId, req.user!.sub, req.user!.role === 'admin');
    if (!owned) {
      return res.status(404).json({ success: false, error: { code: 404, message: 'Meeting not found' } });
    }
    const segments = await MeetingService.getSegments(req.params.meetingId);
    res.json({ success: true, data: segments });
  } catch (error) {
    logger.error(`Failed to fetch transcript: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch transcript' },
    });
  }
});

export default router;
