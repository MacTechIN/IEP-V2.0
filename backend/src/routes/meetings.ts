import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { MeetingService } from '../services/meetingService';
import { RecordingService } from '../services/recordingService';
import { logger } from '../utils/logger';

const router = Router();

// Audio uploads (stored on a mounted volume; used for STT + analysis)
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.audio';
      cb(null, `${req.params.meetingId}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// POST /meetings - 새 미팅 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    const { customerId, title, startTime, endTime, attendees, notes, autoAnalyze } = req.body;
    const userId = req.user!.sub;

    const meeting = await MeetingService.createMeeting({
      userId,
      customerId,
      title,
      startTime,
      endTime,
      attendees,
      notes,
      autoAnalyze,
    });

    logger.info(`Meeting created: ${meeting.id}`);

    res.status(201).json({
      success: true,
      data: meeting,
    });
  } catch (error) {
    logger.error(`Failed to create meeting: ${error}`);
    res.status(400).json({
      success: false,
      error: { code: 400, message: 'Failed to create meeting' },
    });
  }
});

// GET /meetings - 미팅 목록 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.sub;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const { meetings, total } = await MeetingService.getMeetings(userId, { limit, offset });

    res.json({
      success: true,
      data: meetings,
      meta: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (error) {
    logger.error(`Failed to fetch meetings: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch meetings' },
    });
  }
});

// GET /meetings/:meetingId - 미팅 상세 조회
router.get('/:meetingId', async (req: Request, res: Response) => {
  try {
    const meeting = await MeetingService.getMeetingById(
      req.params.meetingId, req.user!.sub, req.user!.role === 'admin');
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'Meeting not found' },
      });
    }
    res.json({ success: true, data: meeting });
  } catch (error) {
    logger.error(`Failed to fetch meeting: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to fetch meeting' },
    });
  }
});

// PATCH /meetings/:meetingId - 미팅 업데이트
router.patch('/:meetingId', async (req: Request, res: Response) => {
  try {
    // 소유 확인이 먼저다
    const owned = await MeetingService.getMeetingById(
      req.params.meetingId, req.user!.sub, req.user!.role === 'admin');
    if (!owned) {
      return res.status(404).json({ success: false, error: { code: 404, message: 'Meeting not found' } });
    }
    const meeting = await MeetingService.updateMeeting(req.params.meetingId, req.body);
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'Meeting not found' },
      });
    }
    logger.info(`Meeting updated: ${req.params.meetingId}`);
    res.json({ success: true, data: meeting });
  } catch (error) {
    logger.error(`Failed to update meeting: ${error}`);
    res.status(400).json({
      success: false,
      error: { code: 400, message: 'Failed to update meeting' },
    });
  }
});

// DELETE /meetings/:meetingId - 미팅 삭제
router.delete('/:meetingId', async (req: Request, res: Response) => {
  try {
    const owned = await MeetingService.getMeetingById(
      req.params.meetingId, req.user!.sub, req.user!.role === 'admin');
    if (!owned) {
      return res.status(404).json({ success: false, error: { code: 404, message: 'Meeting not found' } });
    }
    const success = await MeetingService.deleteMeeting(req.params.meetingId);
    if (!success) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'Meeting not found' },
      });
    }
    logger.info(`Meeting deleted: ${req.params.meetingId}`);
    res.json({ success: true, data: { message: 'Meeting deleted' } });
  } catch (error) {
    logger.error(`Failed to delete meeting: ${error}`);
    res.status(500).json({
      success: false,
      error: { code: 500, message: 'Failed to delete meeting' },
    });
  }
});

// POST /meetings/:meetingId/audio - 녹음 업로드 → STT → 분석 파이프라인 시작
router.post('/:meetingId/audio', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.sub;
    const meeting = await MeetingService.getMeetingById(req.params.meetingId);
    if (!meeting || meeting.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: { code: 404, message: 'Meeting not found' },
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 400, message: 'No audio file uploaded (form field: audio)' },
      });
    }

    await MeetingService.setAudio(req.params.meetingId, req.file.path);
    // Fire-and-forget: transcription + analysis run in the background
    MeetingService.processAudio(req.params.meetingId, req.file.path);

    logger.info(`Audio uploaded for meeting ${req.params.meetingId} (${req.file.size} bytes)`);
    res.status(202).json({
      success: true,
      data: {
        meetingId: req.params.meetingId,
        status: 'processing',
        message: 'Audio received; transcription & analysis started',
      },
    });
  } catch (error) {
    logger.error(`Audio upload failed: ${error}`);
    res.status(400).json({
      success: false,
      error: { code: 400, message: 'Audio upload failed' },
    });
  }
});

// POST /meetings/:meetingId/analyze - 선택된 녹음들을 첨부해 합쳐 분석
router.post('/:meetingId/analyze', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.sub;
    const meeting = await MeetingService.getMeetingById(req.params.meetingId);
    if (!meeting || meeting.userId !== userId) {
      return res.status(404).json({ success: false, error: { code: 404, message: 'Meeting not found' } });
    }
    const recordingIds: string[] = Array.isArray(req.body.recordingIds) ? req.body.recordingIds : [];
    const recordings = await RecordingService.attach(req.params.meetingId, recordingIds, userId);
    await MeetingService.analyzeFromRecordings(req.params.meetingId, recordings);
    logger.info(`Analyze started for meeting ${req.params.meetingId} (${recordings.length} recordings)`);
    res.status(202).json({
      success: true,
      data: { meetingId: req.params.meetingId, status: 'processing', count: recordings.length },
    });
  } catch (error) {
    logger.error(`Analyze failed: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Analyze failed' } });
  }
});

export default router;
