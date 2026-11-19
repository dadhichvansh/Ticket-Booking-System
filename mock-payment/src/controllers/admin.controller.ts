import type { Request, Response } from 'express';
import { parseOrThrow, settingsPatchSchema } from '../utils/validate.js';
import * as adminService from '../services/admin.service.js';

// Send any subset of settings. An empty body {} just returns the current ones.
export const configController = (req: Request, res: Response): void => {
  const patch = parseOrThrow(settingsPatchSchema, req.body ?? {});
  const config = adminService.applyConfig(patch);
  res.status(200).json({ config });
};

export const ledgerController = (_req: Request, res: Response): void => {
  res.status(200).json(adminService.getLedger());
};

export const resetController = (_req: Request, res: Response): void => {
  const config = adminService.resetAll();
  res.status(200).json({ reset: true, config });
};
