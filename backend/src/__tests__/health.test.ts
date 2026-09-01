import request from 'supertest';
import express from 'express';
import { logger } from '../utils/logger';

// Create a minimal app for testing
const createApp = () => {
  const app = express();
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });
  return app;
};

describe('Health Check', () => {
  it('should return 200 OK for health endpoint', async () => {
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
  });
});
