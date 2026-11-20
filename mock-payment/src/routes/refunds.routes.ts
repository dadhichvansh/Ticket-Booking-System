import { Router } from 'express';
import {
  createRefundController,
  getRefundController,
} from '../controllers/refunds.controller.js';

const refundsRouter = Router();

refundsRouter.post('/', createRefundController);
refundsRouter.get('/:refundKey', getRefundController);

export { refundsRouter };
