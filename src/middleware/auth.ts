import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import { verifyToken } from '../services/auth.service.js';

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header) {
    throw new AppError('unauthorized', 'Missing Authorization header');
  }

  const [scheme, token, ...extra] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra.length > 0) {
    throw new AppError('unauthorized', 'Authorization must be: Bearer <token>');
  }

  req.user = verifyToken(token);
  next();
}
