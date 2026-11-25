import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { chargePayment } from '../services/mockPayment.client.js';

// BASELINE ONLY (D-18, D-24). Deleted in M4.

const HOLD_SECONDS = 300; // 5 minutes, same as FR-9

type InsertedRow = {
  created_at: Date;
};

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return typeof err.code === 'string' ? err.code : undefined;
  }
  return undefined;
}

// The hold is a `pending` booking row. The unique index
// uniq_active_booking_per_seat decides who wins (04).
export async function createHold(
  userId: string,
  eventId: string,
  seatId: string,
) {
  try {
    const rows = await query<InsertedRow>(
      `INSERT INTO bookings (user_id, event_id, seat_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING created_at`,
      [userId, eventId, seatId],
    );
    const row = rows[0];
    if (!row) throw new Error('insert returned no row');

    const expiresAt = new Date(row.created_at.getTime() + HOLD_SECONDS * 1000);
    return {
      eventId,
      seatId,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: HOLD_SECONDS,
    };
  } catch (err) {
    const code = pgErrorCode(err);
    // 23505 = unique violation: the seat already has an active booking
    if (code === '23505') {
      throw new AppError('seat_taken', 'Seat is already held or booked');
    }
    // 23503 = foreign key violation: this seat does not belong to this event
    // (the composite key on bookings checks it, so no extra lookup is needed)
    if (code === '23503') {
      throw new AppError('seat_not_found', 'Seat not found for this event');
    }
    throw err;
  }
}

// ---------------------------------------------------------------
// Baseline pay (D-26). Naive on purpose: no idempotency, no write-first
// step, no recovery job. M5 and M6 close these gaps.
// ---------------------------------------------------------------

export type PayResult =
  | {
      kind: 'confirmed';
      booking: {
        id: string;
        eventId: string;
        seatId: string;
        status: 'confirmed';
        priceRupees: number;
      };
    }
  | { kind: 'pending' };

export async function payForHold(
  userId: string,
  eventId: string,
  seatId: string,
): Promise<PayResult> {
  // 1. The hold must exist, belong to this user and not be older than 5 minutes
  const holds = await query<{ id: string }>(
    `SELECT id FROM bookings
     WHERE user_id = $1 AND event_id = $2 AND seat_id = $3
       AND status = 'pending'
       AND created_at > now() - make_interval(secs => $4)`,
    [userId, eventId, seatId, HOLD_SECONDS],
  );
  const hold = holds[0];
  if (!hold) throw new AppError('hold_not_active', 'Hold is no longer active');

  // 2. Price comes from the event, never from the client
  const events = await query<{ price_rupees: number }>(
    'SELECT price_rupees FROM events WHERE id = $1',
    [eventId],
  );
  const event = events[0];
  if (!event) throw new AppError('event_not_found', 'Event not found');
  const price = event.price_rupees;

  // 3. Call the mock. No database connection is held while we wait.
  const paymentKey = `pay_${randomUUID()}`;
  const charge = await chargePayment(paymentKey, price);

  // Unknown result: we do not know if money moved. The baseline saves
  // nothing. This is the NFR-2 gap that M5 and M6 close.
  if (charge.outcome === 'unknown') {
    logger.warn({ paymentKey }, 'baseline pay: charge result unknown');
    return { kind: 'pending' };
  }

  if (charge.outcome === 'failed') {
    await query(
      `INSERT INTO payments
         (payment_key, user_id, event_id, seat_id, amount_rupees, status)
       VALUES ($1, $2, $3, $4, $5, 'failed')`,
      [paymentKey, userId, eventId, seatId, price],
    );
    throw new AppError('payment_failed', 'Payment failed');
  }

  // 4. Charge succeeded: confirm the booking and save the payment together
  const confirmedId = await withTransaction(async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE bookings SET status = 'confirmed', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [hold.id],
    );
    const row = updated.rows[0];

    // If 0 rows changed, the payment is still saved, with booking_id NULL,
    // so the NFR-2 audit can see "charged but no booking".
    await client.query(
      `INSERT INTO payments
         (payment_key, user_id, event_id, seat_id, booking_id,
          amount_rupees, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'succeeded')`,
      [paymentKey, userId, eventId, seatId, row ? row.id : null, price],
    );
    return row ? row.id : null;
  });

  if (!confirmedId) {
    throw new AppError('seat_lost', 'Seat was lost while paying');
  }

  return {
    kind: 'confirmed',
    booking: {
      id: confirmedId,
      eventId,
      seatId,
      status: 'confirmed',
      priceRupees: price,
    },
  };
}
