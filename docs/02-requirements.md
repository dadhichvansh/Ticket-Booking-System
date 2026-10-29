# 02 - Requirements

**Status:** FROZEN v1.0
**Scope frozen on:** 2026-10-12
**Requirements frozen on:** 2026-10-29

## 1. Scope

### 1.1 In scope (v1)

**Booking flow**

- Browse a list of events and view one event's details
- View a seat map showing each seat's status (available, held, booked)
- Select one seat and hold it temporarily; the hold auto-releases on timeout
- Pay for the held seat via a mock payment service that can succeed, fail, or respond slowly
- Receive a booking confirmation and view own bookings

**Cancellation and refund (minimal)**

- A user can cancel their own confirmed booking
- Refund is always full (no policy windows, no partial refunds)
- Refund goes through the mock payment service (can succeed, fail, or be slow)
- Seat returns to available only after the cancellation is durably recorded
- Refunds are idempotent: a retry or double-click never refunds twice
- Booking states: confirmed -> cancelled -> refunded, plus a refund_failed
  path that is retried

**Notifications (mock sender)**

- Booking confirmation and cancellation each enqueue a notification job
- A worker processes jobs with a mock sender (writes to a notifications table or log)
- Retries with backoff, a dead-letter queue, and at-least-once delivery
  (duplicates must be handled)

**Platform and learning goals**

- Basic user identity: signup/login with a token, so holds and bookings have an owner
- Duplicate-request handling (idempotency) for hold, pay, and cancel
- Rate limiting, caching, a queue for background work, and basic metrics
- Load testing with recorded before/after results

### 1.2 Out of scope (non-goals)

- Organizer/admin accounts; creating or editing events (events and seat maps are seeded)
- Real payment gateway integration (mock only)
- Real email/SMS providers (mock sender only)
- Partial refunds, refund policy windows, or cancellation fees
- Pricing tiers, coupons, or dynamic pricing
- Multiple cities, venues, search, or filters
- Multi-seat booking in one transaction (one seat per booking in v1)
- Auth beyond signup and login (no social login, password reset, or roles)
- A polished frontend (one simple working page is enough)
- Cloud deployment (Docker Compose on a local machine is the target)

### 1.3 Scope decisions

| Decision                  | Why                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| One seat per booking      | Multi-seat needs all-or-nothing holds across seats (deadlocks, partial failures). Learn concurrency on the simple case first. |
| Mock payment              | Lets me trigger failure cases on demand, e.g. payment succeeds but system crashes before confirming.                          |
| Minimal auth              | Holds and bookings need an owner; nothing more.                                                                               |
| Cancellation/refund added | High learning value: idempotency, state machines, compensating actions.                                                       |
| Mock notifications added  | Learn queue consumers, retries, and failure handling without provider setup.                                                  |

### 1.4 Change control

Scope is frozen. New ideas go to docs/08-parking-lot.md. A change is allowed
only if it is a genuine bug in the requirements (a contradiction or something
that makes the system impossible), and must be logged in CHANGELOG.md with
date, reason, and impact.

## 2. Functional Requirements

### 2.1 Users

- FR-1: A user can sign up with an email and password.
- FR-2: A user can log in and receive an auth token. All other actions
  require a valid token, except signing up, logging in, browsing events,
  and viewing seat maps.
- FR-3: Passwords are stored hashed, never in plain text.

### 2.2 Browsing

- FR-4: Anyone can list all events and view one event's details.
- FR-5: Anyone can view an event's seat map (no login required), where each
  seat shows its status: available, held, or booked.

### 2.3 Holding a seat

- FR-6: A logged-in user can request a hold on one available seat.
- FR-7: If the seat is available, the hold succeeds and the seat becomes
  held for that user until the hold expires (except after a Redis restart,
  see NFR-12 and D-2).
- FR-8: If the seat is already held or booked, the request is rejected
  immediately with a clear conflict error.
- FR-9: A hold expires automatically after a fixed duration (default
  5 minutes, configurable), and the seat becomes available again.
- FR-10: A user can have at most one active hold at a time, across all
  events (not one per event).
- FR-11: A user can release their own hold before it expires.

### 2.4 Payment and booking

- FR-12: A user can pay for their active hold via the mock payment service.
- FR-13: Payment is only accepted for a hold that is active and owned by
  the paying user.
- FR-14: If payment succeeds, the booking is confirmed and the seat becomes
  booked.
- FR-15: If payment fails, the hold remains until it expires or the user
  releases it, and the user may retry payment.
- FR-16: Every payment attempt is linked to a specific hold. If the hold
  expires or the seat is lost while a payment is in flight, the system must
  never end with a payment taken and no seat. Either the booking is
  confirmed, or the payment is refunded exactly once, the booking is
  recorded as cancelled, and the user is notified (per FR-25).
- FR-17: A user can view a list of their own bookings and each booking's
  current state.

### 2.5 Cancellation and refund

- FR-18: A user can cancel their own confirmed booking.
- FR-19: Cancelling triggers a full refund through the mock payment service.
- FR-20: The seat becomes available again only after the cancellation is
  durably recorded.
- FR-21: A refund happens exactly once per cancelled booking, even if the
  cancel request is retried or double-clicked.
- FR-22: If the refund fails, the booking moves to refund_failed and the
  system retries the refund automatically until it succeeds or reaches a
  retry limit. When the retry limit is exhausted, the refund job moves to a dead-letter
  queue and the booking stays refund_failed for manual resolution. Tests for
  NFR-2 and NFR-3 run with the mock refund configured to eventually succeed.

### 2.6 Idempotency

- FR-23: Hold, pay, and cancel requests accept an idempotency key. Repeating
  a request with the same key returns the original result and causes no
  second side effect.

### 2.7 Notifications

- FR-24: Confirming a booking enqueues a notification job.
- FR-25: Cancelling a booking enqueues a notification job.
- FR-26: A worker processes notification jobs with a mock sender that
  records each notification to a table.
- FR-27: Failed notification jobs are retried with backoff and moved to a
  dead-letter queue after the retry limit.
- FR-28: Delivery is at-least-once, so a duplicate job must not create a
  duplicate notification record.

### 2.8 Protection and visibility

- FR-29: Requests are rate limited per user and per IP, and a limited
  request receives a clear "too many requests" response.
- FR-30: The system exposes basic metrics (request rate, error rate,
  latency, successful and failed holds).

### 2.9 Booking states

- Normal path: pending -> confirmed
- Cancellation path: confirmed -> cancelled -> refunded
- Seat lost during payment (FR-16): pending -> cancelled -> refunded
- Refund failure (FR-22): cancelled -> refund_failed -> (retry) -> refunded

## 3. Non-Functional Requirements

### 3.1 Correctness (absolute, verified under load and failure)

- NFR-1: Double bookings = 0. No seat is ever confirmed for two users.
- NFR-2: Payments taken with no booking and no refund = 0 after the system
  settles (see FR-16).
- NFR-3: Refunds issued per cancelled booking = exactly 1 (see FR-21).
- NFR-4: A seat is never both available and booked at the same time;
  state is consistent between DB and cache after recovery.

### 3.2 Reference load scenario ("the stampede")

- NFR-5: 5,000 simulated users compete for 200 seats of one event within
  a 10-second window, with a mix of seat selections (some contention on
  popular seats, some spread out). This is the scenario all performance
  targets are measured against.

### 3.3 Performance (targets, measured with k6 or Artillery)

- NFR-6: Seat map read: p95 latency < 100 ms, p99 < 300 ms during the
  stampede.
- NFR-7: Hold request (success or conflict): p95 < 300 ms during the
  stampede.
- NFR-8: Users who lose a seat contention get a conflict response in
  < 500 ms at p95 (fail fast, never hang).
- NFR-9: Sustained throughput of at least 500 requests/second on the
  mixed workload on the target machine.
- NFR-10: Unexpected error rate (5xx, timeouts) < 1% during the stampede.
  Conflict responses (409) are expected and not counted as errors.

### 3.4 Reliability and recovery

- NFR-11: Killing one app instance during load causes no data corruption
  and no violation of NFR-1 to NFR-4.
- NFR-12: Restarting Redis loses no confirmed bookings; holds may be lost
  but the system recovers to a consistent state.
- NFR-13: If the notification worker is down, booking and cancellation
  still succeed; jobs are processed when the worker returns.
- NFR-14: Expired holds are released within 10 seconds of expiry.

### 3.5 Scalability

- NFR-15: The app runs as at least 2 instances behind Nginx, with no
  correctness violations (NFR-1 to NFR-4) compared to 1 instance.

### 3.6 Abuse protection

- NFR-16: Rate limit defaults: 20 requests/second per user and
  100 requests/second per IP, configurable.

### 3.7 Observability

- NFR-17: Metrics expose request rate, error rate, latency percentiles,
  hold success/conflict counts, and queue depth.
- NFR-18: Every request carries a correlation ID that appears in logs.

### 3.8 Reproducibility

- NFR-19: The whole system starts with a single `docker compose up`,
  including seed data.
- NFR-20: Every benchmark in 09-benchmarks.md records the machine specs,
  scenario, date, and exact commands so anyone can rerun it.

### 3.9 Assumptions

- A-1: Single region, single PostgreSQL primary; no multi-region.
- A-2: The mock payment service responds in 50-2000 ms and fails ~10%
  of the time (configurable).
- A-3: Benchmarks run on one developer machine, not a cloud cluster.
- A-4: Seed data: a few events with 200 to 1,000 seats each.
- A-5: Benchmarks for NFR-5 to NFR-10 run with the per-IP rate limit raised
  or bypassed (the per-user limit stays on). Rate limiting is verified in
  its own separate test scenario (FR-29, NFR-16).
- A-6: Target machine specs (CPU, RAM, OS) are recorded in 09-benchmarks.md
  before the first benchmark (see NFR-9, NFR-20).
