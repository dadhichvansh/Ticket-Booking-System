import type { Request, Response } from 'express';
import {
  chargeBodySchema,
  parseOrThrow,
  paymentKeyParamsSchema,
} from '../utils/validate.js';
import * as chargesService from '../services/charges.service.js';

export const createChargeController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = parseOrThrow(chargeBodySchema, req.body ?? {});
  const reply = await chargesService.createCharge(body);
  res.status(200).json(reply);
};

export const getChargeController = (req: Request, res: Response): void => {
  const { paymentKey } = parseOrThrow(paymentKeyParamsSchema, req.params);
  const status = chargesService.getChargeStatus(paymentKey);
  res.status(200).json({ status });
};
