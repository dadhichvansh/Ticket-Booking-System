import type { NextFunction, Request, Response } from 'express';

// Saves the mounted path (for example /api/auth) before an error can reset it
export function rememberBase(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.locals.baseUrl = req.baseUrl;
  next();
}
