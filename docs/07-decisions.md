# 07 - Decisions

## D-1: Add cancellation/refund and mock notifications to v1

- Date: 2026-10-12
- Alternatives: keep both out of v1 (parking lot); use a real email/SMS provider
- Why: exercise idempotency, state machines, and queue failure handling (stated learning goals)
- Trade-offs: v1 grows by about two milestones; constrained to full refunds and mock sender

## D-2: Holds may be lost on Redis restart; bookings may not

- Date: 2026-10-29
- Alternatives: persist holds in PostgreSQL as the source of truth; Redis persistence (AOF)
- Why: holds are short-lived (5 min) and the DB is the source of truth for confirmed bookings
- Trade-offs: after a Redis restart, some users lose their hold and must retry; recovery logic must be correct (NFR-12, NFR-4)
- Status: closed (defended) on 2026-10-30. Section 5.2 of 03-system-design.md covers it: pay without a hold is rejected, payments already `started` continue, the PostgreSQL constraint decides, and an optional rebuild reduces conflicts. Revisit only if failure test 4 (restart Redis during the stampede) fails in Phase 4.

## D-3: Redis decides holds; PostgreSQL is the final judge for bookings

- Date: 2026-10-30
- Alternatives: database only; Redis only
- Why: Redis is fast and auto-expires holds, so losers get a quick 409. A unique constraint in PostgreSQL makes double booking impossible even if Redis or the app is wrong (NFR-1).
- Trade-offs: two places hold seat state, so they can disagree (NFR-4); recovery logic must be correct
- Build order: database-only version first, then add Redis, so the benchmark shows the difference

## D-4: Seat-map cache lives only 2 seconds, with no manual invalidation

- Date: 2026-10-30
- Alternatives: invalidate the cache on every hold or booking; longer cache time; no cache
- Why: a 2-second cache takes almost all read load off PostgreSQL during the stampede (NFR-6), and a stale map is harmless because the hold step is the real authority and gives a 409
- Trade-offs: users can briefly see a seat as free that is already held, and get a 409 when they click it

## D-5: Seat holds are taken with one atomic Lua script in Redis

- Date: 2026-10-30
- Alternatives: separate check and set commands; Redis transactions (WATCH/MULTI); locking in PostgreSQL
- Why: check-and-set must be one uninterruptible step, and a Lua script also lets me enforce "one hold per user" (FR-10) across two keys in the same step
- Trade-offs: the logic lives in a script that needs careful testing; Redis cannot enforce the rule after a restart, so the PostgreSQL constraint remains the final judge (D-3)

## D-6: Double booking is blocked by a partial unique index on active bookings

- Date: 2026-10-31
- Alternatives: plain UNIQUE (seat_id); one row per seat with a status column; locking in app code
- Why: only `pending` and `confirmed` bookings block a seat, so a cancelled seat can be booked again (FR-20), and PostgreSQL refuses a second active booking even if Redis or the app is wrong (NFR-1, D-3)
- Trade-offs: a "seat lost during payment" booking must be inserted directly as `cancelled`; status changes need guarded updates (UPDATE ... WHERE status = 'confirmed')

## D-7: Only one payment in flight per user and seat; refunds get a `dead` status

- Date: 2026-10-31
- Alternatives: no guard (rely on idempotency keys only); lock in app code; no `dead` status (recovery re-sends forever)
- Why: a partial unique index on in-flight payments lets PostgreSQL stop a double charge even if the idempotency layer is bypassed (NFR-2). The `dead` status keeps the retry limit real (FR-22) and lets the recovery job skip refunds waiting for manual resolution.
- Trade-offs: if a payment is stuck `started`, the same user cannot pay again for that seat until the recovery job marks it `failed` (about 60 to 90 seconds)

## D-8: Duplicates are stopped by unique constraints on (booking, type)

- Date: 2026-10-31
- Alternatives: a free-text dedupe key; checking in app code before inserting; no outbox uniqueness
- Why: `UNIQUE (booking_id, type)` on `notifications` and `outbox` lets PostgreSQL reject duplicates (FR-28), even when RabbitMQ delivers a job twice
- Trade-offs: each booking gets at most one notification of each type. This is enough for v1, because a booking is confirmed, cancelled and refunded at most once each.
