import type { Request, Response } from 'express';
import { AppError } from '../errors.js';
import { holdBodySchema, parseOrThrow } from '../utils/validate.js';
import * as baselineService from './baseline.service.js';

export const createHoldController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthorized', 'Missing user');

  const { eventId, seatId } = parseOrThrow(holdBodySchema, req.body);
  const hold = await baselineService.createHold(userId, eventId, seatId);
  res.status(201).json({ hold });
};
