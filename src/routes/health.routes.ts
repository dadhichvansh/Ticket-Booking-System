import { Router } from 'express';
import {
  liveController,
  readyController,
} from '../controllers/health.controller.js';

const healthRouter = Router();

healthRouter.get('/live', liveController);
healthRouter.get('/ready', readyController);

export { healthRouter };
