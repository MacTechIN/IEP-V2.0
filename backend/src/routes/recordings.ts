import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { RecordingService } from '../services/recordingService';
import { logger } from '../utils/logger';

const router = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.audio';
      cb(null, `rec-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// POST /recordings - 녹음 1건 업로드 + 개별 전사 (draft)
router.post('/', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 400, message: 'No audio file (field: audio)' } });
    }
    const duration = req.body.durationSeconds ? parseInt(req.body.durationSeconds, 10) : null;
    const rec = await RecordingService.createDraft(req.user!.sub, req.file.path, req.body.label || null, duration);
    res.status(201).json({ success: true, data: rec });
  } catch (error) {
    logger.error(`Recording upload failed: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Recording upload failed' } });
  }
});

// GET /recordings/drafts - 미첨부 녹음 목록
router.get('/drafts', async (req: Request, res: Response) => {
  try {
    const list = await RecordingService.listDrafts(req.user!.sub);
    res.json({ success: true, data: list });
  } catch (error) {
    logger.error(`Failed to list recordings: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed to list recordings' } });
  }
});

// PATCH /recordings/:id - 라벨/선택 변경
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const rec = await RecordingService.update(req.params.id, req.user!.sub, req.body);
    if (!rec) return res.status(404).json({ success: false, error: { code: 404, message: 'Recording not found' } });
    res.json({ success: true, data: rec });
  } catch (error) {
    logger.error(`Failed to update recording: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Failed to update recording' } });
  }
});

// DELETE /recordings/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ok = await RecordingService.remove(req.params.id, req.user!.sub);
    if (!ok) return res.status(404).json({ success: false, error: { code: 404, message: 'Recording not found' } });
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    logger.error(`Failed to delete recording: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed to delete recording' } });
  }
});

export default router;
