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

export const createPaymentController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthorized', 'Missing user');

  const { eventId, seatId } = parseOrThrow(holdBodySchema, req.body);
  const result = await baselineService.payForHold(userId, eventId, seatId);

  if (result.kind === 'pending') {
    res.status(202).json({
      status: 'payment_pending',
      message: 'We are confirming your payment. Check again in a minute.',
    });
    return;
  }
  res.status(201).json({ booking: result.booking });
};
