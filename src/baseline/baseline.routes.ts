import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createHoldController } from './baseline.controller.js';

const baselineRouter = Router();

baselineRouter.post('/holds', requireAuth, createHoldController);

export { baselineRouter };
