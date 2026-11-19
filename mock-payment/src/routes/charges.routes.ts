import { Router } from 'express';
import {
  createChargeController,
  getChargeController,
} from '../controllers/charges.controller.js';

const chargesRouter = Router();

chargesRouter.post('/', createChargeController);
chargesRouter.get('/:paymentKey', getChargeController);

export { chargesRouter };
