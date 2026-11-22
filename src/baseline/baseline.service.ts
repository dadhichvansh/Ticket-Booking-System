import { query } from '../db.js';
import { AppError } from '../errors.js';

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
