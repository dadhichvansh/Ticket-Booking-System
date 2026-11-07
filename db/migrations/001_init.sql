-- 001_init.sql
-- Source: docs/04-database-schema.md (requirements v1.0)
-- Creation order: users, events, seats, bookings, payments, refunds,
--                 idempotency_keys, notifications, outbox

-- ============================================================
-- Step 1: Core tables
-- ============================================================

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         TEXT NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  price_rupees INTEGER NOT NULL CHECK (price_rupees >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- ============================================================
-- Step 2: Payments and refunds
-- ============================================================

CREATE TABLE payments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_key   TEXT NOT NULL UNIQUE,            -- sent to the payment service; same key = charged once
  user_id       BIGINT NOT NULL REFERENCES users(id),
  event_id      BIGINT NOT NULL,
  seat_id       BIGINT NOT NULL,
  booking_id    BIGINT UNIQUE REFERENCES bookings(id),  -- NULL until a booking exists
  amount_rupees INTEGER NOT NULL CHECK (amount_rupees >= 0),
  status        TEXT NOT NULL CHECK (status IN ('started','succeeded','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id    BIGINT NOT NULL UNIQUE REFERENCES bookings(id),  -- ONE refund per booking (NFR-3)
  payment_id    BIGINT NOT NULL REFERENCES payments(id),
  refund_key    TEXT NOT NULL UNIQUE,            -- sent to the payment service on every attempt
  amount_rupees INTEGER NOT NULL CHECK (amount_rupees >= 0),
  status        TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','dead')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recovery job: refunds with no recent progress (03, section 5.4 rule 6)
CREATE INDEX idx_refunds_unfinished
  ON refunds (updated_at)
  WHERE status IN ('pending', 'failed');

-- ============================================================
-- Step 3: Idempotency keys, notifications, outbox
-- ============================================================

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
