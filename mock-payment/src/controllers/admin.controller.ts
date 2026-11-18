import type { Request, Response } from 'express';
import { db } from '../db.js';
import { sendError } from '../http.js';
import {
  getSettings,
  resetSettings,
  settingsPatchSchema,
  updateSettings,
} from '../settings.js';

type ChargeRow = {
  id: number;
  payment_key: string;
  amount_rupees: number;
  status: string;
  reason: string | null;
  created_at: string;
};

type RefundRow = {
  id: number;
  refund_key: string;
  payment_key: string;
  amount_rupees: number;
  created_at: string;
};

// Send any subset of settings. An empty body {} just returns the current ones.
export const configController = (req: Request, res: Response) => {
  const parsed = settingsPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    sendError(
      res,
      400,
      'validation_error',
      `${field}: ${issue?.message ?? 'invalid'}`,
    );
    return;
  }

  const result = updateSettings(parsed.data);
  if (!result.ok) {
    sendError(res, 400, 'validation_error', result.message);
    return;
  }
  res.status(200).json({ config: result.settings });
};

// Everything the mock accepted. The NFR-2 and NFR-3 checks compare this
// with the app's database (04 Step 4).
export const ledgerController = (_req: Request, res: Response) => {
  // better-sqlite3 is synchronous and Node runs one request at a time here,
  // so both reads see the same state. No transaction needed.
  const charges = db
    .prepare(
      `SELECT id, payment_key, amount_rupees, status, reason, created_at
       FROM charges ORDER BY id`,
    )
    .all() as ChargeRow[];

  const refunds = db
    .prepare(
      `SELECT id, refund_key, payment_key, amount_rupees, created_at
       FROM refunds ORDER BY id`,
    )
    .all() as RefundRow[];

  // Only succeeded charges moved money
  const succeeded = charges.filter((c) => c.status === 'succeeded');

  res.status(200).json({
    charges: charges.map((c) => ({
      chargeId: `ch_${c.id}`,
      paymentKey: c.payment_key,
      amountRupees: c.amount_rupees,
      status: c.status,
      reason: c.reason,
      createdAt: c.created_at,
    })),
    refunds: refunds.map((r) => ({
      refundKey: r.refund_key,
      paymentKey: r.payment_key,
      amountRupees: r.amount_rupees,
      createdAt: r.created_at,
    })),
    totals: {
      chargeCount: succeeded.length,
      refundCount: refunds.length,
      chargedRupees: succeeded.reduce((sum, c) => sum + c.amount_rupees, 0),
      refundedRupees: refunds.reduce((sum, r) => sum + r.amount_rupees, 0),
    },
  });
};

// Clears all data and puts the settings back to defaults, between test runs
export const resetController = (_req: Request, res: Response) => {
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM refunds').run();
    db.prepare('DELETE FROM refund_attempts').run();
    db.prepare('DELETE FROM charges').run();
    // Restart the id counters, so the next charge is ch_1 again
    db.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('charges', 'refunds')",
    ).run();
  });
  wipe();
  resetSettings();
  res.status(200).json({ reset: true, config: getSettings() });
};
