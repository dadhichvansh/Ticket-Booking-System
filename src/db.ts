import pg from 'pg';
import type { QueryResultRow } from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

export const pool = new pg.Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
  max: 10, // starting value, not measured. We tune it with benchmarks later.
});

// Without this handler, an error on an idle connection crashes the process
pool.on('error', (err) => {
  logger.error({ err }, 'postgres pool error');
});

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
