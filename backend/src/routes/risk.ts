import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAIService } from '../services/openaiService';
import { logger } from '../utils/logger';

const router = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
      cb(null, `risk-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname) || '.webm'}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// POST /risk - 대화 조각 → 빠른 전사 → 위험·기회 판정 (클립은 처리 후 즉시 삭제)
router.post('/', upload.single('audio'), async (req: Request, res: Response) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      return res.status(400).json({ success: false, error: { code: 400, message: 'No audio clip' } });
    }
    const text = await OpenAIService.transcribeQuick(filePath);
    if (!text || text.trim().length < 2) {
      return res.json({
        success: true,
        data: { level: 'normal', reason: '(무음/짧음)', script: '', action: '', transcript: text || '' },
      });
    }
    const assessment = await OpenAIService.assessRisk(text, req.body.context);
    res.json({
      success: true,
      data: { ...(assessment || { level: 'normal', reason: '', script: '', action: '' }), transcript: text },
    });
  } catch (error) {
    logger.error(`Risk check failed: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Risk check failed' } });
  } finally {
    if (filePath) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
  }
});

export default router;
