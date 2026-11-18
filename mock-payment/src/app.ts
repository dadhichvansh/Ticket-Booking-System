import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { db } from './db.js';
import { logger } from './logger.js';
import { adminRouter } from './routes/admin.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Used by Docker later. Opens the database to prove it is usable.
app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    logger.error({ err }, 'health check failed');
    res.status(503).json({ status: 'unavailable' });
  }
});

app.use('/admin', adminRouter);

const notFound: RequestHandler = (_req, res) => {
  res
    .status(404)
    .json({ error: { code: 'not_found', message: 'Route not found' } });
};
app.use(notFound);

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (typeof err === 'object' && err !== null && 'type' in err) {
    if (err.type === 'entity.parse.failed') {
      res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'Invalid JSON' } });
      return;
    }
    if (err.type === 'entity.too.large') {
      res.status(400).json({
        error: { code: 'body_too_large', message: 'Request body too large' },
      });
      return;
    }
  }

  logger.error({ err }, 'request failed');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong' },
  });
};
app.use(errorHandler);
