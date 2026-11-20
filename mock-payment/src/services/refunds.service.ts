import { setTimeout as sleep } from 'node:timers/promises';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import type { RefundBody } from '../utils/validate.js';
import { getSettings } from './settings.service.js';

type ChargeRow = {
  payment_key: string;
  amount_rupees: number;
  status: 'processing' | 'succeeded' | 'failed';
};

export type RefundReply =
  | { status: 'succeeded'; alreadyProcessed?: true }
  | { status: 'failed'; reason: string };

const findRefund = db.prepare(
  'SELECT refund_key FROM refunds WHERE refund_key = ?',
);

const findCharge = db.prepare(
  'SELECT payment_key, amount_rupees, status FROM charges WHERE payment_key = ?',
);

// Counts every attempt for this key, in one statement
const countAttempt = db.prepare(
  `INSERT INTO refund_attempts (refund_key, attempts) VALUES (?, 1)
   ON CONFLICT(refund_key) DO UPDATE SET attempts = attempts + 1
   RETURNING attempts`,
);

const insertRefund = db.prepare(
  `INSERT INTO refunds (refund_key, payment_key, amount_rupees)
   VALUES (?, ?, ?)`,
);

export async function createRefund({
  refundKey,
  paymentKey,
  amountRupees,
}: RefundBody): Promise<RefundReply> {
  // Already refunded with this key: no new refund, no money moves
  if (findRefund.get(refundKey)) {
    return { status: 'succeeded', alreadyProcessed: true };
  }

  const charge = findCharge.get(paymentKey) as ChargeRow | undefined;
  if (!charge) {
    throw new AppError('charge_not_found', 'No charge for this paymentKey');
  }
  if (charge.status !== 'succeeded') {
    throw new AppError(
      'refund_not_allowed',
      'Only a succeeded charge can be refunded',
    );
  }
  if (charge.amount_rupees !== amountRupees) {
    throw new AppError(
      'amount_mismatch',
      'Refund must be for the full charged amount',
    );
  }

  // Decide the result first, using the current settings.
  // Every attempt is counted, even a failed one.
  const settings = getSettings();
  const row = countAttempt.get(refundKey) as { attempts: number };
  const willFail =
    row.attempts <= settings.refundFailUntilAttempt ||
    Math.random() < settings.refundFailureRate;
  const delayMs =
    settings.minDelayMs +
    Math.random() * (settings.maxDelayMs - settings.minDelayMs);

  await sleep(delayMs);

  // A failed attempt saves nothing in `refunds`, so a retry tries again
  if (willFail) {
    return { status: 'failed', reason: 'refund_failed' };
  }

  // Two requests with the same key can both reach this point after sleeping.
  // There is no await between this check and the insert, so only one inserts.
  if (findRefund.get(refundKey)) {
    return { status: 'succeeded', alreadyProcessed: true };
  }

  insertRefund.run(refundKey, paymentKey, amountRupees);
  return { status: 'succeeded' };
}

export function getRefundStatus(refundKey: string): 'succeeded' {
  const row = findRefund.get(refundKey);
  if (!row) {
    // 404 means no money was refunded for this key
    throw new AppError('refund_not_found', 'No refund for this refundKey');
  }
  return 'succeeded';
}
