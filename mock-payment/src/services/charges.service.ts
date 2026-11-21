import { setTimeout as sleep } from 'node:timers/promises';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import type { ChargeBody } from '../utils/validate.js';
import { getSettings } from './settings.service.js';

type ChargeStatus = 'processing' | 'succeeded' | 'failed';

type ChargeRow = {
  id: number;
  payment_key: string;
  amount_rupees: number;
  status: ChargeStatus;
  reason: string | null;
};

export type ChargeReply =
  | { status: 'succeeded'; chargeId: string }
  | { status: 'failed'; reason: string }
  | { status: 'processing' };

const findCharge = db.prepare(
  `SELECT id, payment_key, amount_rupees, status, reason
   FROM charges WHERE payment_key = ?`,
);

const insertProcessing = db.prepare(
  `INSERT INTO charges (payment_key, amount_rupees, status)
   VALUES (?, ?, 'processing')`,
);

const saveResult = db.prepare(
  `UPDATE charges
   SET status = ?, reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = ?`,
);

// The reply for a charge that already exists
function toReply(row: ChargeRow): ChargeReply {
  if (row.status === 'succeeded') {
    return { status: 'succeeded', chargeId: `ch_${row.id}` };
  }
  if (row.status === 'failed') {
    return { status: 'failed', reason: row.reason ?? 'card_declined' };
  }
  return { status: 'processing' };
}

// Test only (05 section 8.3). Exits at once, without the clean shutdown.
function crashNow(mode: string): never {
  logger.warn({ mode }, 'chargeMode: crashing on purpose');
  process.exit(1);
}

// Test only. A promise that never finishes, so no reply is ever sent
// and the client has to give up by itself (timeout).
function neverReply(): Promise<never> {
  return new Promise<never>(() => {});
}

export async function createCharge({
  paymentKey,
  amountRupees,
}: ChargeBody): Promise<ChargeReply> {
  // Known key: never charge again, answer from what is saved.
  // This runs before any chargeMode logic, in every mode.
  const existing = findCharge.get(paymentKey) as ChargeRow | undefined;
  if (existing) {
    if (existing.amount_rupees !== amountRupees) {
      throw new AppError(
        'amount_mismatch',
        'This paymentKey was used with a different amount',
      );
    }
    return toReply(existing);
  }

  // New key. Decide the result first, using the current settings
  const settings = getSettings();

  // Exits before anything is saved: the mock never "received" this key
  if (settings.chargeMode === 'crash_before_charge') {
    crashNow(settings.chargeMode);
  }

  const willFail =
    settings.chargeMode === 'always_fail' ||
    Math.random() < settings.failureRate;
  const delayMs =
    settings.minDelayMs +
    Math.random() * (settings.maxDelayMs - settings.minDelayMs);

  // Save as 'processing' BEFORE the delay. There is no await between the
  // lookup above and this insert, so two requests cannot both get here.
  // UNIQUE on payment_key is the backup.
  const info = insertProcessing.run(paymentKey, amountRupees);
  const id = Number(info.lastInsertRowid);

  await sleep(delayMs);

  if (willFail) {
    saveResult.run('failed', 'card_declined', id);
    return { status: 'failed', reason: 'card_declined' };
  }

  // The charge is saved (on disk, synchronous = FULL) before any of this
  saveResult.run('succeeded', null, id);

  if (settings.chargeMode === 'crash_after_charge') {
    crashNow(settings.chargeMode);
  }
  if (settings.chargeMode === 'timeout_after_charge') {
    logger.warn({ paymentKey }, 'chargeMode: charge saved, reply never sent');
    return neverReply();
  }

  return { status: 'succeeded', chargeId: `ch_${id}` };
}

export function getChargeStatus(paymentKey: string): ChargeStatus {
  const row = findCharge.get(paymentKey) as ChargeRow | undefined;
  if (!row) {
    // 404 means the mock never received this key, so nothing was charged
    throw new AppError('charge_not_found', 'No charge for this paymentKey');
  }
  return row.status;
}
