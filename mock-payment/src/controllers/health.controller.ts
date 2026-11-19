import type { Request, Response } from 'express';
import { db } from '../db.js';
import { logger } from '../logger.js';

// Used by Docker later. Opens the database to prove it is usable.
export const healthController = (_req: Request, res: Response): void => {
  try {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    logger.error({ err }, 'health check failed');
    res.status(503).json({ status: 'unavailable' });
  }
};
