import { Router, Request, Response } from 'express';
import { CustomerService } from '../services/customerService';
import { logger } from '../utils/logger';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.sub;
    const customer = await CustomerService.createCustomer({ userId, ...req.body });
    logger.info(`Customer created: ${customer.id}`);
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    logger.error(`Failed to create customer: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Failed to create customer' } });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.sub;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const { customers, total } = await CustomerService.getCustomers(userId, { limit, offset });
    res.json({ success: true, data: customers, meta: { total, limit, offset, hasMore: offset + limit < total } });
  } catch (error) {
    logger.error(`Failed to fetch customers: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed to fetch customers' } });
  }
});

router.get('/:customerId', async (req: Request, res: Response) => {
  try {
    const customer = await CustomerService.getCustomerById(
      req.params.customerId, req.user!.sub, req.user!.role === 'admin');
    if (!customer) return res.status(404).json({ success: false, error: { code: 404, message: 'Customer not found' } });
    res.json({ success: true, data: customer });
  } catch (error) {
    logger.error(`Failed to fetch customer: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed to fetch customer' } });
  }
});

router.patch('/:customerId', async (req: Request, res: Response) => {
  try {
    // 소유 확인이 먼저다. 남의 고객이면 여기서 404 로 끝난다.
    const owned = await CustomerService.getCustomerById(
      req.params.customerId, req.user!.sub, req.user!.role === 'admin');
    if (!owned) return res.status(404).json({ success: false, error: { code: 404, message: 'Customer not found' } });
    const customer = await CustomerService.updateCustomer(req.params.customerId, req.body);
    if (!customer) return res.status(404).json({ success: false, error: { code: 404, message: 'Customer not found' } });
    res.json({ success: true, data: customer });
  } catch (error) {
    logger.error(`Failed to update customer: ${error}`);
    res.status(400).json({ success: false, error: { code: 400, message: 'Failed to update customer' } });
  }
});

router.delete('/:customerId', async (req: Request, res: Response) => {
  try {
    const owned = await CustomerService.getCustomerById(
      req.params.customerId, req.user!.sub, req.user!.role === 'admin');
    if (!owned) return res.status(404).json({ success: false, error: { code: 404, message: 'Customer not found' } });
    const success = await CustomerService.deleteCustomer(req.params.customerId);
    if (!success) return res.status(404).json({ success: false, error: { code: 404, message: 'Customer not found' } });
    res.json({ success: true, data: { message: 'Customer deleted' } });
  } catch (error) {
    logger.error(`Failed to delete customer: ${error}`);
    res.status(500).json({ success: false, error: { code: 500, message: 'Failed to delete customer' } });
  }
});

export default router;
