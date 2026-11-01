# 04 - Database Schema (PostgreSQL)

Status: COMPLETE (proof tests run in Phase 3)
Requirements: v1.0 (frozen)

## Conventions

- IDs: `BIGINT GENERATED ALWAYS AS IDENTITY` (simple, fast, easy to read in logs).
- Times: `TIMESTAMPTZ`, default `now()`.
- Money: whole smallest units (`price_rupees`), never floats.
- Statuses: `TEXT` + `CHECK` constraint (easier to change than a PG ENUM).

## Step 1: Core tables

```sql
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  price_rupees INTEGER NOT NULL CHECK (price_rupees >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seats (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    BIGINT NOT NULL REFERENCES events(id),
  row_label   TEXT NOT NULL,
  seat_number INTEGER NOT NULL,
  UNIQUE (event_id, row_label, seat_number),  -- no duplicate seats in one event
  UNIQUE (id, event_id)                       -- needed for the safe link from bookings
);

CREATE TABLE bookings (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  event_id   BIGINT NOT NULL,
  seat_id    BIGINT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN
             ('pending','confirmed','cancelled','refund_failed','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- the seat must belong to the same event written in this row
  FOREIGN KEY (seat_id, event_id) REFERENCES seats (id, event_id)
);

-- THE DOUBLE-BOOKING GUARD (NFR-1)
CREATE UNIQUE INDEX uniq_active_booking_per_seat
  ON bookings (seat_id)
  WHERE status IN ('pending', 'confirmed');

-- Hot query: "which seats are taken for this event?" (seat map rebuild)
CREATE INDEX idx_bookings_event_active
  ON bookings (event_id, seat_id)
  WHERE status IN ('pending', 'confirmed');

-- Hot query: "show my bookings" (FR-17)
CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);
```

## Why each important choice

- **Partial unique index:** only active bookings (`pending`, `confirmed`) block a seat.
  Cancelled / refund_failed / refunded do not, so FR-20 works.
- **`event_id` inside bookings + composite foreign key:** the seat and event cannot
  disagree, and the seat-map query does not need a join.
- **Status as TEXT + CHECK:** matches the booking state machine in 02 (section 2.9).

## Proof test (run in Phase 3 once Postgres is up)

1. Insert a `confirmed` booking for seat 1. Works.
2. Insert another `confirmed` booking for seat 1. Must FAIL with error code `23505` (unique violation).
3. Update the first booking to `cancelled`.
4. Insert a new `confirmed` booking for seat 1. Must WORK now.
5. Insert two `cancelled` bookings for the same seat. Both must WORK (cancelled rows never block).

## Notes

- **Seat lost during payment (FR-16):** the loser's booking cannot be created as
  `pending`, because the unique index would reject it (the seat already has an
  active booking). So the row is created directly as `cancelled`, together with
  its refund record and outbox row, in a NEW transaction (the failed insert
  cancels the first one). The path "pending -> cancelled -> refunded" in 02 is the
  logical story; in the table the row starts at `cancelled`. No requirements change.
- **Normal flow:** 03 (Flow 3) creates the booking directly as `confirmed`.
  `pending` stays in the CHECK because the frozen state machine lists it, but
  the current flow does not use it.
- **Status changes must be guarded in app code**, for example
  `UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=? AND status='confirmed'`.
  If 0 rows change, nothing happened (this protects cancel against double-clicks).
- **FR-10 (one hold per user)** lives in Redis only, not in this schema.

## Step 2: Payments and refunds

```sql
CREATE TABLE payments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_key  TEXT NOT NULL UNIQUE,            -- sent to the payment service; same key = charged once
  user_id      BIGINT NOT NULL REFERENCES users(id),
  event_id     BIGINT NOT NULL,
  seat_id      BIGINT NOT NULL,
  booking_id   BIGINT UNIQUE REFERENCES bookings(id),  -- NULL until a booking exists
  amount_rupees INTEGER NOT NULL CHECK (amount_rupees >= 0),
  status       TEXT NOT NULL CHECK (status IN ('started','succeeded','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (seat_id, event_id) REFERENCES seats (id, event_id),
  -- a payment can only point to a booking after it succeeded
  CHECK (booking_id IS NULL OR status = 'succeeded')
);

-- Only ONE payment "in flight" per user and seat (stops a double charge from a double-click)
CREATE UNIQUE INDEX uniq_inflight_payment
  ON payments (user_id, seat_id)
  WHERE status = 'started' OR (status = 'succeeded' AND booking_id IS NULL);

-- Recovery job: payments stuck 'started' or 'succeeded-without-booking' (03, section 5.1)
CREATE INDEX idx_payments_stuck
  ON payments (updated_at)
  WHERE status = 'started' OR (status = 'succeeded' AND booking_id IS NULL);

CREATE TABLE refunds (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id   BIGINT NOT NULL UNIQUE REFERENCES bookings(id),  -- ONE refund per booking (NFR-3)
  payment_id   BIGINT NOT NULL REFERENCES payments(id),
  refund_key   TEXT NOT NULL UNIQUE,            -- sent to the payment service on every attempt
  amount_rupees INTEGER NOT NULL CHECK (amount_rupees >= 0),
  status       TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','dead')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recovery job: refunds with no recent progress (03, section 5.4 rule 6)
CREATE INDEX idx_refunds_unfinished
  ON refunds (updated_at)
  WHERE status IN ('pending', 'failed');
```

## Why each important choice

- **`payment_key` UNIQUE:** the app saves the payment BEFORE calling the payment
  service (write first, act second). The same key sent twice charges once (NFR-2).
- **`booking_id` can be NULL:** the payment exists before the booking. The recovery job
  finds "succeeded without booking" with `status = 'succeeded' AND booking_id IS NULL`.
- **`UNIQUE` on `booking_id`:** one booking has at most one payment.
- **No hold column:** the hold lives in Redis. `user_id + event_id + seat_id` identifies
  it, because a user has only one hold at a time (FR-10). Section 5.2 uses these
  columns to re-hold seats after a Redis restart.
- **`uniq_inflight_payment`:** a second in-flight payment for the same user and seat is
  rejected by PostgreSQL. This is the "server layer" from 03 section 5.3.
  A payment leaves "in flight" when it becomes `failed`, or gets a booking.
- **`refunds.booking_id` UNIQUE:** PostgreSQL itself refuses a second refund for one
  booking (NFR-3, FR-21).
- **`dead` status:** the retry limit is used up (FR-22). The job is in the dead-letter
  queue, the booking stays `refund_failed`, and a person resolves it.
  The recovery job must NOT re-send `dead` refunds, or the limit would mean nothing.
- **`attempts`, `last_error`:** let you see why a refund is stuck without reading logs.

## How the two tables follow the flows

- **Normal pay (Flow 3):** insert payment `started` -> call service -> update to `succeeded`
  -> ONE transaction: insert booking `confirmed` + set `payments.booking_id` + outbox row.
- **Seat lost:** that transaction fails. In a NEW transaction: insert the booking as
  `cancelled`, set `payments.booking_id` to it, insert the refund `pending`, and insert
  two outbox rows: `refund_needed` and `notify_cancelled` (FR-16, FR-25).
- **Cancel (5.4):** ONE transaction: booking `confirmed` -> `cancelled` (guarded update),
  insert refund `pending`, and insert two outbox rows: `refund_needed` and
  `notify_cancelled` (FR-25).
- **Refund result:** success -> refund `succeeded` + booking `refunded`.
  Failure -> refund `failed` + booking `refund_failed`, `attempts` + 1.
  Limit reached -> refund `dead`.
- **`updated_at`:** the app sets it on every update (no trigger, to keep it simple).
  The recovery job depends on it.
- **"Stuck" for refunds:** `pending` or `failed` with no change for more than 15 minutes.
  This is longer than the longest wait queue (10 minutes), so a refund that is just
  waiting for its retry is not re-sent by mistake.

## Proof test (run in Phase 3)

1. Insert two payments with the same `payment_key`. The second must FAIL (`23505`).
2. Insert two `started` payments for the same user and seat. The second must FAIL.
3. Update the first to `failed`, then insert a new `started` payment for the same user and seat. Must WORK.
4. Insert a payment with `booking_id` set and `status = 'started'`. Must FAIL (CHECK).
5. Insert two refunds for the same booking. The second must FAIL (`23505`).
6. Insert two refunds with the same `refund_key`. The second must FAIL.

## Step 3: Idempotency keys, notifications, outbox

```sql
CREATE TABLE idempotency_keys (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id),
  idem_key            TEXT NOT NULL,              -- random ID made by the browser per click
  endpoint            TEXT NOT NULL CHECK (endpoint IN ('hold','pay','cancel')),
  request_fingerprint TEXT NOT NULL,              -- hash of endpoint + body (same key, different request = 422)
  status              TEXT NOT NULL CHECK (status IN ('in_progress','done')),
  response_status     INTEGER,                    -- saved HTTP status, filled when done
  response_body       JSONB,                      -- saved response, filled when done
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key),                     -- the "claim the key" step (03, section 5.3)
  CHECK (status = 'in_progress' OR response_status IS NOT NULL)
);

-- Cleanup of old keys (optional, run by the worker later)
CREATE INDEX idx_idem_created ON idempotency_keys (created_at);

CREATE TABLE notifications (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  booking_id BIGINT NOT NULL REFERENCES bookings(id),
  type       TEXT NOT NULL CHECK (type IN ('confirmed','cancelled','refunded')),
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, type)       -- a duplicate job cannot create a duplicate record (FR-28)
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE outbox (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id),
  type       TEXT NOT NULL CHECK (type IN
             ('refund_needed','notify_confirmed','notify_cancelled','notify_refunded')),
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ,                         -- NULL = not sent to RabbitMQ yet
  UNIQUE (booking_id, type)                       -- one obligation of each kind per booking
);

-- Outbox sender: "which rows are still unsent?" (03, section 5.5 case B)
CREATE INDEX idx_outbox_unsent ON outbox (id) WHERE sent_at IS NULL;
```

## Why each important choice

- **`UNIQUE (user_id, idem_key)`:** the insert that "claims" the key. If two app copies
  insert at the same instant, PostgreSQL lets only one win.
- **Only hold, pay, cancel:** FR-23 lists only these three. Signup and login do not use keys.
- **Taking over a crashed request (5.3 rule 5):** one guarded update, like this:
  `UPDATE idempotency_keys SET updated_at = now() WHERE user_id=? AND idem_key=? AND status='in_progress' AND updated_at < now() - interval '2 minutes'`
  If 0 rows change, someone else is still working, so return 409.
- **`CHECK` on `done`:** a key cannot be marked `done` without a saved response.
- **`notifications` UNIQUE (booking_id, type):** the worker inserts with
  `INSERT ... ON CONFLICT DO NOTHING`. A repeated job does nothing (FR-28).
  Types match FR-24 (confirmed), FR-25 (cancelled) and the refund success step in 5.4 (refunded).
  The "seat lost during payment" user gets `cancelled` (FR-16).
- **`outbox` UNIQUE (booking_id, type):** each booking can have at most one
  `refund_needed` and one of each notification type. This is the same
  "write first, queue second" rule as 5.1 and 5.4.
- **`idx_outbox_unsent`:** a partial index, so it stays tiny. Sent rows leave the index.
- **No table for the dead-letter queue:** FR-27 says failed notification jobs move to a
  dead-letter queue. That lives in RabbitMQ. For refunds, the `dead` status in `refunds`
  is the record.

## How the outbox is used

- **App:** inserts the outbox row in the SAME transaction as the booking change.
  After commit, it sends to RabbitMQ and sets `sent_at = now()`.
- **Outbox sender (worker):** every few seconds, reads rows with `sent_at IS NULL`
  and older than about 10 seconds, so it does not fight the app's own send.
  Use `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100`, so two workers never take the same rows.
- **A row can be sent twice** (sent, then crash before `sent_at` was saved). This is fine:
  delivery is at-least-once, and the consumers already handle duplicates
  (`notifications` unique, refund key unique).

## Proof test (run in Phase 3)

1. Insert two idempotency keys with the same (user, key). The second must FAIL (`23505`).
2. Insert a key with `status = 'done'` and no `response_status`. Must FAIL (CHECK).
3. Insert two notifications with the same (booking, type). The second must FAIL, and
   `ON CONFLICT DO NOTHING` must change 0 rows.
4. Insert two outbox rows with the same (booking, type). The second must FAIL.
5. Insert an outbox row, then check that it appears in `WHERE sent_at IS NULL`.
   Set `sent_at`, and check that it disappears.

## Step 4: Final check

### Table creation order (for the Phase 3 migration file)

users -> events -> seats -> bookings -> payments -> refunds -> idempotency_keys -> notifications -> outbox
(Each table only points to tables above it.)

### Requirement -> constraint map

| Requirement                     | What enforces it                                                                    | Where              |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| NFR-1 no double booking         | partial unique index `uniq_active_booking_per_seat`                                 | bookings           |
| FR-20 seat free after cancel    | same index ignores cancelled / refund_failed / refunded                             | bookings           |
| NFR-2 payment never lost        | `payment_key` UNIQUE, `uniq_inflight_payment`, nullable `booking_id` + recovery job | payments           |
| NFR-3, FR-21 one refund         | `booking_id` UNIQUE, `refund_key` UNIQUE                                            | refunds            |
| FR-22 retry limit               | `status = 'dead'`, `attempts`                                                       | refunds            |
| FR-23 idempotency               | UNIQUE (user_id, idem_key)                                                          | idempotency_keys   |
| FR-28 no duplicate notification | UNIQUE (booking_id, type)                                                           | notifications      |
| 03 section 5.5 case B           | outbox rows + `idx_outbox_unsent`                                                   | outbox             |
| Seat and event agree            | composite foreign key (seat_id, event_id)                                           | bookings, payments |
| State machines (02, 2.9)        | CHECK on every `status` column                                                      | all                |
| FR-3 hashed passwords           | `password_hash` column (hashing is app code)                                        | users              |

**Not in PostgreSQL (Redis only):** FR-9 hold expiry, FR-10 one hold per user, NFR-14.

### Settle check (run FIRST, after the load test stops)

Wait until all of these return 0. Until then the system has not "settled" (NFR-2).

```sql
SELECT
  (SELECT count(*) FROM payments WHERE status = 'started')                      AS payments_started,
  (SELECT count(*) FROM outbox WHERE sent_at IS NULL)                           AS outbox_unsent,
  (SELECT count(*) FROM refunds WHERE status IN ('pending','failed'))           AS refunds_unfinished,
  (SELECT count(*) FROM idempotency_keys
     WHERE status = 'in_progress' AND updated_at < now() - interval '2 minutes') AS idem_stuck;
```

### NFR-1: double bookings = 0

```sql
-- Expect 0 rows. (The index makes this impossible, so this is an audit.)
SELECT seat_id, count(*) FROM bookings
WHERE status IN ('pending','confirmed')
GROUP BY seat_id HAVING count(*) > 1;

-- Expect the number to be <= seats in the event (200 in the stampede).
SELECT count(*) FROM bookings WHERE event_id = :event_id AND status = 'confirmed';
```

### NFR-2: no payment without a booking or a refund

```sql
-- A: charged, but no booking at all. Expect 0 rows.
SELECT id FROM payments WHERE status = 'succeeded' AND booking_id IS NULL;

-- B: booking was cancelled, but no refund record exists. Expect 0 rows.
SELECT b.id FROM bookings b
WHERE b.status IN ('cancelled','refund_failed','refunded')
  AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.booking_id = b.id);

-- C: refund not finished after settling. Expect 0 rows
-- (tests run with the mock refund set to eventually succeed, FR-22).
SELECT id FROM refunds WHERE status <> 'succeeded';
```

Also compare with the mock payment service's list: every charge there must match a
payment that has a confirmed booking, or a refund that succeeded.

### NFR-3: exactly one refund per cancelled booking

```sql
-- Cancelled bookings with 0 or 2+ refunds. Expect 0 rows.
SELECT b.id, count(r.id) AS refunds
FROM bookings b LEFT JOIN refunds r ON r.booking_id = b.id
WHERE b.status IN ('cancelled','refund_failed','refunded')
GROUP BY b.id HAVING count(r.id) <> 1;

-- Refunds on bookings that were never cancelled. Expect 0 rows.
SELECT r.id FROM refunds r JOIN bookings b ON b.id = r.booking_id
WHERE b.status IN ('pending','confirmed');
```

Also check in the mock payment service: refunds it actually executed per
`refund_key` must be exactly 1.

### NFR-4: seat never both available and booked; DB and Redis agree

Run this AFTER waiting longer than the hold time (5 min) plus a small margin, so normal
leftover holds have expired.

1. List all `hold:*` keys from Redis (use `SCAN`, never `KEYS`) and collect their seat ids.
2. Ask PostgreSQL which of those seats already have an active booking:

```sql
-- :seat_ids = the seat ids found in Redis. Expect 0 rows.
SELECT seat_id FROM bookings
WHERE status IN ('pending','confirmed') AND seat_id = ANY(:seat_ids);
```

3. Call the seat-map API for the event. Every seat with an active booking must show
   `booked`, never `available`.

### Notifications (failure tests 1 and 2: worker down, RabbitMQ down)

```sql
-- Notification jobs that never produced a record. Expect 0 rows after settling.
SELECT o.id FROM outbox o
LEFT JOIN notifications n
  ON n.booking_id = o.booking_id AND n.type = replace(o.type, 'notify_', '')
WHERE o.type LIKE 'notify_%' AND n.id IS NULL;
```

Duplicates cannot appear, because of UNIQUE (booking_id, type) (FR-28).

### What the database cannot prove

The constraints guard what is SAVED. They cannot see money moving inside the payment
service, so NFR-2 and NFR-3 are only fully proven when the DB queries above AND the
mock service's own list agree.
