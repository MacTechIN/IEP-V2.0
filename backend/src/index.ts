import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { authMiddleware } from './middleware/auth';
import { requireAdmin } from './middleware/adminAuth';
import { initializeDatabase } from './utils/database';
import { OpenAIService } from './services/openaiService';
import { attachStreamGateway } from './services/streamGateway';

// 환경변수 로드
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Initialize database and OpenAI before starting server
async function startServer() {
  try {
    await initializeDatabase();
    logger.info('✓ Database initialized successfully');

    // Initialize OpenAI service
    OpenAIService.initialize();
    if (OpenAIService.isEnabled()) {
      logger.info('✓ OpenAI API initialized');
    } else {
      logger.info('ℹ OpenAI API not configured - using simulation mode');
    }
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(requestLogger);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v2/auth', require('./routes/auth').default);

// Protected Routes (require authentication)
app.use('/api/v2/meetings', authMiddleware, require('./routes/meetings').default);
app.use('/api/v2/recordings', authMiddleware, require('./routes/recordings').default);
app.use('/api/v2/risk', authMiddleware, require('./routes/risk').default);
app.use('/api/v2/customers', authMiddleware, require('./routes/customers').default);
app.use('/api/v2/analysis', authMiddleware, require('./routes/analysis').default);
app.use('/api/v2/actions', authMiddleware, require('./routes/actions').default);
app.use('/api/v2/dashboard', authMiddleware, require('./routes/dashboard').default);
app.use('/api/v2/users', authMiddleware, require('./routes/users').default);
app.use('/api/v2/analytics', authMiddleware, require('./routes/analytics').default);
app.use('/api/v2/admin', authMiddleware, requireAdmin, require('./routes/admin').default);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 404,
      message: 'Not Found',
    },
  });
});

// Error Handler
app.use(errorHandler);

// Start Server
startServer().then(() => {
  const server = app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📝 Environment: ${process.env.NODE_ENV}`);
    logger.info(`📊 API Base URL: http://localhost:${PORT}/api/v2`);
    logger.info(`💾 Database: PostgreSQL`);
  });
  // RT-1: 실시간 스트리밍 STT 게이트웨이 (WebSocket)
  attachStreamGateway(server);
});

export default app;
