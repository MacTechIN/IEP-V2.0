import { Router, Request, Response } from 'express';
import { ActionService } from '../services/actionService';
import { logger } from '../utils/logger';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const action = await ActionService.createAction(req.body);
    logger.info(`Action created: ${action.id}`);
    res.status(201).json({ success: true, data: action });
  } catch (error) {
    logger.error(`Failed to create action: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Failed' } });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const { actions, total } = await ActionService.getActions({ limit, offset, status: req.query.status as string });
    res.json({ success: true, data: actions, meta: { total, limit, offset, hasMore: offset + limit < total } });
  } catch (error) {
    logger.error(`Failed to fetch actions: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed' } });
  }
});

router.patch('/:actionId', async (req: Request, res: Response) => {
  try {
    const action = await ActionService.updateAction(req.params.actionId, req.body);
    if (!action) return res.status(404).json({ success: false, error: { code: 404, message: 'Not found' } });
    res.json({ success: true, data: action });
  } catch (error) {
    logger.error(`Failed to update action: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Failed' } });
  }
});

router.delete('/:actionId', async (req: Request, res: Response) => {
  try {
    const success = await ActionService.deleteAction(req.params.actionId);
    if (!success) return res.status(404).json({ success: false, error: { code: 404, message: 'Not found' } });
    res.json({ success: true, data: { message: 'Deleted' } });
  } catch (error) {
    logger.error(`Failed to delete action: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed' } });
  }
});

export default router;
