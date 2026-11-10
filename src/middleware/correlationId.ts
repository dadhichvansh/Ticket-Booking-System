import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContext } from '../logger.js';

const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/;

export function correlationId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-correlation-id');
  const id =
    incoming !== undefined && SAFE_ID.test(incoming) ? incoming : randomUUID();

  req.correlationId = id;
  res.setHeader('x-correlation-id', id);

  // Everything that runs inside next() can log with this ID automatically
  requestContext.run({ correlationId: id }, () => next());
}
