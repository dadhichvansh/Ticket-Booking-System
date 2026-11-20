import type { Request, Response } from 'express';
import {
  parseOrThrow,
  refundBodySchema,
  refundKeyParamsSchema,
} from '../utils/validate.js';
import * as refundsService from '../services/refunds.service.js';

export const createRefundController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = parseOrThrow(refundBodySchema, req.body ?? {});
  const reply = await refundsService.createRefund(body);
  res.status(200).json(reply);
};

export const getRefundController = (req: Request, res: Response): void => {
  const { refundKey } = parseOrThrow(refundKeyParamsSchema, req.params);
  const status = refundsService.getRefundStatus(refundKey);
  res.status(200).json({ status });
};
