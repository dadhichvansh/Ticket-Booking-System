import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';

export function notFound(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(new AppError('not_found', 'Route not found'));
}
