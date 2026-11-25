import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createHoldController,
  createPaymentController,
} from './baseline.controller.js';

const baselineRouter = Router();

baselineRouter.post('/holds', requireAuth, createHoldController);
baselineRouter.post('/payments', requireAuth, createPaymentController);

export { baselineRouter };
