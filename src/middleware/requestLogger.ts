import type { NextFunction, Request, Response } from 'express';
import { logger, requestContext } from '../logger.js';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.originalUrl.startsWith('/health')) return; // 05 section 10.1

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const base = (res.locals.baseUrl as string | undefined) ?? '';
    const route = req.route?.path ? `${base}${req.route.path}` : 'unmatched';
    const data = {
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };

    // Set the context again here, so the correlationId is always on this line
    requestContext.run({ correlationId: req.correlationId }, () => {
      if (res.statusCode >= 500) logger.error(data, 'request completed');
      else logger.info(data, 'request completed');
    });
  });

  next();
}
