import { Router } from 'express';
import {
  configController,
  ledgerController,
  resetController,
} from '../controllers/admin.controller.js';

const adminRouter = Router();

adminRouter.post('/config', configController);
adminRouter.get('/ledger', ledgerController);
adminRouter.post('/reset', resetController);

export { adminRouter };
