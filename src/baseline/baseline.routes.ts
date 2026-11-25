import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  cancelBookingController,
  createHoldController,
  createPaymentController,
} from './baseline.controller.js';

const baselineRouter = Router();

baselineRouter.post('/holds', requireAuth, createHoldController);
baselineRouter.post('/payments', requireAuth, createPaymentController);
baselineRouter.post('/bookings/:bookingId/cancel', requireAuth, cancelBookingController);

export { baselineRouter };
