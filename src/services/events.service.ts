import { query } from '../db.js';
import { AppError } from '../errors.js';

type EventRow = {
  id: string; // BIGINT comes back from pg as a string
  name: string;
  starts_at: Date; // TIMESTAMPTZ comes back as a JS Date
  price_rupees: number; // INTEGER comes back as a number
  total_seats: number; // count() is BIGINT, so we cast it to int in SQL
};

type SeatRow = {
  id: string; // BIGINT comes back as a string
  row_label: string;
  seat_number: number; // INTEGER comes back as a number
};

type BookedSeatRow = {
  seat_id: string;
};

// totalSeats is counted from the seats table (05 section 3.3).
// LEFT JOIN so an event with no seats still appears, with 0.
const SELECT_EVENT = `
  SELECT e.id, e.name, e.starts_at, e.price_rupees,
         count(s.id)::int AS total_seats
  FROM events e
  LEFT JOIN seats s ON s.event_id = e.id
`;

function toEvent(row: EventRow) {
  return {
    id: row.id,
    name: row.name,
    startsAt: row.starts_at.toISOString(),
    priceRupees: row.price_rupees,
    totalSeats: row.total_seats,
  };
}

export async function listEvents() {
  const rows = await query<EventRow>(
    `${SELECT_EVENT} GROUP BY e.id ORDER BY e.starts_at, e.id`,
  );
  return rows.map(toEvent);
}

export async function getEvent(eventId: string) {
  const rows = await query<EventRow>(
    `${SELECT_EVENT} WHERE e.id = $1 GROUP BY e.id`,
    [eventId],
  );
  const row = rows[0];
  if (!row) throw new AppError('event_not_found', 'Event not found');
  return toEvent(row);
}

// Seat map from PostgreSQL only (05 section 3.5). Redis holds come in M4.
export async function getSeatMap(eventId: string) {
  const eventRows = await query<{ id: string }>(
    'SELECT id FROM events WHERE id = $1',
    [eventId],
  );
  if (!eventRows[0]) throw new AppError('event_not_found', 'Event not found');

  // Row labels may grow past one letter (A..Z, AA, AB...). Shorter labels first,
  // then alphabetical, so B comes before AA.
  const seatsQuery = query<SeatRow>(
    `SELECT id, row_label, seat_number
     FROM seats
     WHERE event_id = $1
     ORDER BY length(row_label), row_label, seat_number`,
    [eventId],
  );

  // Uses idx_bookings_event_active (04). Only active bookings block a seat,
  // so cancelled, refund_failed and refunded rows are not listed (FR-20).
  const bookedQuery = query<BookedSeatRow>(
    `SELECT seat_id
     FROM bookings
     WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
    [eventId],
  );

  const [seats, booked] = await Promise.all([seatsQuery, bookedQuery]);
  const bookedIds = new Set(booked.map((b) => b.seat_id));

  return {
    eventId,
    generatedAt: new Date().toISOString(),
    seats: seats.map((s) => ({
      id: s.id,
      row: s.row_label,
      number: s.seat_number,
      status: bookedIds.has(s.id) ? ('booked' as const) : ('available' as const),
    })),
  };
}