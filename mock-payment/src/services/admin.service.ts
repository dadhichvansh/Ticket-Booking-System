import { db } from '../db.js';
import type { SettingsPatch } from '../utils/validate.js';
import {
  getSettings,
  resetSettings,
  updateSettings,
  type Settings,
} from './settings.service.js';

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

export function applyConfig(patch: SettingsPatch): Settings {
  return updateSettings(patch);
}

// Everything the mock accepted. The NFR-2 and NFR-3 checks compare this
// with the app's database (04 Step 4).
export function getLedger() {
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

  return {
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
  };
}

// Clears all data and puts the settings back to defaults, between test runs
export function resetAll(): Settings {
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
  return getSettings();
}
