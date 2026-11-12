import type { Request, Response } from 'express';
import { pool } from '../db.js';

async function checkPostgres(): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), 1000).unref();
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return true;
  } catch {
    return false;
  }
}

export const liveController = (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
};

export const readyController = async (_req: Request, res: Response) => {
  const postgresUp = await checkPostgres();

  // Redis and RabbitMQ are not built yet (M4 and M6), so "down" is the true answer.
  // The status code depends on PostgreSQL only (05 section 10.1).
  res.status(postgresUp ? 200 : 503).json({
    status: postgresUp ? 'ok' : 'unavailable',
    postgres: postgresUp ? 'up' : 'down',
    redis: 'down',
    rabbitmq: 'down',
  });
};
