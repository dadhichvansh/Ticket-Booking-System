import { query } from '../db.js';
import { AppError } from '../errors.js';

type EventRow = {
  id: string; // BIGINT comes back from pg as a string
  name: string;
  starts_at: Date; // TIMESTAMPTZ comes back as a JS Date
  price_rupees: number; // INTEGER comes back as a number
  total_seats: number; // count() is BIGINT, so we cast it to int in SQL
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
