# 03 - System Design

**Status:** COMPLETE

## 1. Components

| Component                     | Job                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Browser (simple React page)   | Shows events and the seat map, sends requests                                         |
| Nginx                         | Spreads incoming requests across the app copies                                       |
| App (Node/Express), 2+ copies | Handles the API. Stateless: keeps nothing important in its own memory                 |
| Redis                         | Seat holds (auto-expiring), seat-map cache, rate-limit counters                       |
| PostgreSQL                    | Source of truth: users, events, seats, bookings, payments                             |
| RabbitMQ                      | Holds background jobs safely (notifications, refund retries) with a dead-letter queue |
| Worker                        | Reads jobs from RabbitMQ and runs them: sends notifications, retries refunds          |
| Mock payment service          | Pretends to be a payment provider: succeeds, fails, or is slow                        |

## 2. Diagram

Browser -> Nginx -> App copy 1 / App copy 2
App copies -> Redis (holds, seat-map cache, rate limits)
App copies -> PostgreSQL (bookings, payments, everything permanent)
App copies -> Mock payment service
App copies -> RabbitMQ (enqueue jobs)
Worker <- RabbitMQ (reads jobs); Worker -> PostgreSQL (notifications, refunds)
Worker -> Mock payment service (refund retries)

## 3. Request flows (high level)

**Flow 1: View seat map**

1. App checks the Redis cache for this event's seat map.
2. If found, return it. If not, read from PostgreSQL, store it in Redis briefly, return it.

**Flow 2: Hold a seat**

1. App checks the user's token and rate limit.
2. App asks Redis: "give seat X to this user, only if nobody has it, for 5 minutes."
3. Redis says yes (return hold details) or no (return 409 immediately).

**Flow 3: Pay and confirm**

1. App checks the hold exists and belongs to this user.
2. App saves a payment record in PostgreSQL (status `started`, with a unique payment key).
3. App extends the hold so it won't expire mid-payment, then calls the mock payment service with the payment key.
4. On success, one database transaction creates the confirmed booking. The unique constraint rejects it if the seat was somehow already booked.
5. If the booking is saved: release the hold, and record "notification needed" in PostgreSQL in the same transaction as the booking, then send it to RabbitMQ. If the database rejected it: record "refund needed" in PostgreSQL, then send it to RabbitMQ (FR-16).
6. On payment failure: the hold stays so the user can retry (FR-15).

## 4. Rule for every component

The app copies are stateless. Nothing that decides who owns a seat lives in one copy's memory.

## 5. Failure handling

### 5.1 Crash between "payment succeeded" and "booking saved"

**Problem:** The user is charged, but the app dies before saving the booking.
Nothing is left running to refund or confirm, which would break NFR-2.

**Rule: write first, act second.**

1. Before calling the payment service, save a payment record in PostgreSQL:
   status = `started`, with the hold's user, event, seat, and a unique
   payment key.
2. Call the payment service and send the same payment key. If we ask twice
   with the same key, the user is charged only once.
3. Save the result in PostgreSQL: `succeeded` or `failed`.
4. If `succeeded`, create the booking (see Flow 3).

**Recovery job (runs every ~30 seconds, in the worker):**
It looks for payment records stuck in `started` or `succeeded-without-booking`
for more than 60 seconds. For each one it asks the payment service: "What
happened to payment key X?"

| Payment service says   | Seat situation                    | Action                                                                                            |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Not charged            | any                               | Mark payment `failed`. Nothing to refund.                                                         |
| Charged                | Seat is free or still this user's | Create the booking (confirmed).                                                                   |
| Charged                | Seat was taken by someone else    | Record "refund needed", refund, booking becomes cancelled then refunded (FR-16), notify the user. |
| Cannot reach / unknown | any                               | Do nothing, try again next round. Never guess.                                                    |

**Why this works:**

- The payment record sits in PostgreSQL, so it survives any app or Redis crash.
- The recovery job needs only the payment record, not the Redis hold, which may be gone (D-2).
- The unique constraint still stops double booking if two recovery rounds run.
- Every outcome is either a booking or a refund, so NFR-2 holds.

**Related rule:** while a payment is `started`, the hold must not expire.
The hold's timer is extended once when payment begins (the "payment in
progress" step in Flow 3). This makes the race in FR-16 rare, and
reconciliation handles the cases that remain.

**Needs from the mock payment service:** a "check status by payment key"
endpoint, plus the ability to be told to crash or time out on demand (A-2).
This isn't new scope, it's what makes the failure tests possible.

### 5.2 Redis restarts and holds are lost (D-2, NFR-4)

**Problem:** Redis restarts and forgets every hold and the seat-map cache.
Users' screens still show "seat held for you". Some users are mid-payment.

**Rule 1: Pay without an active hold is rejected before any payment starts.**
The app returns 409 "hold no longer active". No payment record is created and
no money moves (FR-13). The user can try to hold the seat again.

**Rule 2: A payment already `started` keeps going.**
The payment record lives in PostgreSQL, so the restart does not affect it.
When the payment result arrives, the app tries to save the booking. The unique
constraint decides: if the seat is still free, the booking is saved. If
someone else booked it, the booking is rejected and the payment is refunded
(FR-16, section 5.1).

**Rule 3: Rebuild after a restart (reduces conflicts, not required for correctness).**
When the app notices Redis was wiped (a marker key is missing), it runs a
one-time rebuild before accepting new holds:

- Seats with a `started` payment are re-held in Redis for that user.
- The seat-map cache is rebuilt from PostgreSQL (booked seats from bookings).

This keeps the hot path (hold requests) off the database. If a hold request
sneaks in before the rebuild finishes, Rule 2 still prevents a double booking.

**Example: seat 12.**
User A has a `started` payment for seat 12. Redis restarts. User B holds
seat 12.

- If A's booking is saved first, B's later booking is rejected by the
  constraint, and B is refunded.
- If B's booking is saved first, A's is rejected and A is refunded.
- Either way: one booking, one refund, no double booking.

**Why this is acceptable:** a user may lose a hold and retry, which costs
convenience only. Confirmed bookings and payments never depend on Redis.

### 5.3 Duplicate and concurrent requests (FR-23)

**Problem:** Users double-click, browsers retry, and networks resend. The same
request can arrive twice, sometimes at the same instant on two different app
copies. Hold, pay, and cancel must not do their work twice.

**Rule 1: The client sends an idempotency key.**
The browser creates a random ID when the user clicks and resends the same ID
on every retry of that click. A new click makes a new ID.

**Rule 2: The server stores the key in PostgreSQL.**
A table `idempotency_keys` holds: key, user, endpoint, request fingerprint,
status (`in_progress` or `done`), saved response, and created time.
The key has a unique constraint on (user, key).

**Rule 3: Claim the key first, in one step.**
At the start of the request, the app inserts the key as `in_progress`.

- Insert succeeds: this is the first request. Do the work, then save the
  response and mark the key `done`.
- Insert fails (key exists, `done`): return the saved response. No new work.
- Insert fails (key exists, `in_progress`): another copy is working on it.
  Return 409 "request in progress, retry shortly".

**Rule 4: Same key, different request is an error.**
If the key exists but the fingerprint (endpoint plus body) differs, return 422. This catches client bugs.

**Rule 5: A crashed request must not block the key forever.**
If a key stays `in_progress` longer than 2 minutes, a retry may take it over.
This is safe because the work underneath is also protected: the payment key
(5.1) stops a second charge, and the booking constraint stops a second booking.

**Rule 6: Cancel and refund.**
Cancel uses the same key mechanism. The refund also has its own unique refund
key per booking, so even a retry that gets past the idempotency table cannot
refund twice (FR-21, NFR-3).

**Two layers on purpose:**

| Layer                                          | Protects against                                  |
| ---------------------------------------------- | ------------------------------------------------- |
| Idempotency key (client)                       | The user's repeats: double-click, browser retry   |
| Payment/refund key and DB constraints (server) | The system's repeats: recovery job, crash retries |

**Hold requests:** the hold is already atomic in Redis, so a repeat by the same
user for the same seat returns the existing hold instead of a 409. The
idempotency key also covers the hold request, but the Redis check is the
real protection.

### 5.4 Refund failure and retries (FR-22, FR-21, NFR-3)

**Problem:** The refund call fails or times out. The booking is cancelled, the
seat may be free, but the user has not got their money back.

**Rule 1: Record the intent first.**
Cancelling saves, in one PostgreSQL transaction: booking -> `cancelled`, a
refund record with status `pending` and a unique refund key (one per booking),
and a "refund needed" outbox row. Only then is the job sent to RabbitMQ.
(Same "write first, queue second" rule as 5.1.)

**Rule 2: The worker does the refund.**
The worker reads the job, calls the payment service with the refund key, and
saves the result:

- Success: refund -> `succeeded`, booking -> `refunded`, notification queued.
- Failure: refund -> `failed`, booking -> `refund_failed`, retry scheduled.

**Rule 3: Retry with growing waits.**
RabbitMQ has no built-in delay, so use a "wait queue":

- Failed jobs go to a wait queue with a time-to-live (for example 5s, 30s,
  2 min, 10 min).
- When the time is up, RabbitMQ sends the job back to the main queue.
- After the retry limit (default 5), the job goes to the dead-letter queue.
  The booking stays `refund_failed` for manual resolution (FR-22).

**Rule 4: A retry must never refund twice.**
The refund key is sent to the payment service every time, and the refund record
has a unique constraint on the booking. If the service says "already refunded",
the worker treats that as success.

**Rule 5: Unknown outcome means ask, never guess.**
If the refund call times out, the worker doesn't know if money moved. On the
next attempt it first asks the payment service for the status of the refund
key, same as the payment recovery in 5.1.

**Rule 6: A lost queue message is recovered from PostgreSQL.**
The recovery job also scans for refunds stuck in `pending` or `failed` that
have no live job, and re-sends them. RabbitMQ can lose a message, but
PostgreSQL remembers the obligation (NFR-2).

**Seat release:** the seat becomes available once the cancellation is saved
(FR-20), not when the refund succeeds. The refund is about money, and the seat
is not affected by it.

### 5.5 Worker or queue down, and app copy killed (NFR-13, NFR-11)

**Case A: The worker is down.**
Booking and cancellation never wait for the worker. They save to PostgreSQL
and send the job to RabbitMQ. Jobs wait in the queue (RabbitMQ stores them on
disk) and run when the worker returns. Duplicates are possible, so the worker
checks a unique key before writing a notification (FR-28).

**Case B: RabbitMQ is down.**
The app cannot send the job, but the obligation is already saved in PostgreSQL
(the outbox row from Flow 3 and 5.4). A small "outbox sender" in the worker scans
for unsent rows and sends them when RabbitMQ is back. The user's booking or
cancellation still succeeds (NFR-13). Nothing is lost, only delayed.

**Case C: An app copy is killed during load (NFR-11).**
Because app copies are stateless (section 4), there is nothing to lose in
memory. What happens to requests in flight:

| Request was at                   | Result                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Before payment started           | Client times out, retries with the same idempotency key, runs again on another copy |
| Payment `started`                | Recovery job finishes it (5.1)                                                      |
| Booking saved, response not sent | Retry returns the saved response (5.3)                                              |
| Booking saved, job not sent      | Outbox sender sends it (Case B)                                                     |

Nginx notices the dead copy and stops sending requests to it. Clients that were
mid-request retry, and the idempotency key makes the retry safe.

**Tests (these become Phase 4 checks):**

1. Stop the worker during the stampede, restart it, check that all notifications arrive once.
2. Stop RabbitMQ during the stampede, restart it, check that no job is lost.
3. Kill one app copy during the stampede, then run the NFR-1 to NFR-4 queries.
4. Restart Redis during the stampede, then run the same queries.

## 6. Redis data design

### 6.1 What lives in Redis

| Data                | Key                                            | Value                | Lifetime                   |
| ------------------- | ---------------------------------------------- | -------------------- | -------------------------- |
| Seat hold           | `hold:{eventId}:{seatId}`                      | user ID              | 5 min (configurable, FR-9) |
| User's current hold | `userhold:{userId}`                            | `{eventId}:{seatId}` | same as the hold           |
| Seat-map cache      | `seatmap:{eventId}`                            | computed map         | 2 seconds                  |
| Rate-limit counters | `rl:user:{id}:{second}`, `rl:ip:{ip}:{second}` | counter              | 2 seconds                  |
| Restart marker      | `redis:boot`                                   | timestamp            | no expiry                  |

Nothing else. Bookings, payments, and idempotency keys stay in PostgreSQL.

### 6.2 Taking a hold (one atomic step)

Checking and setting must not be separate commands (race condition). The app
runs one small Lua script, which Redis executes without interruption:

1. If `userhold:{userId}` exists:
   - if it points to this same seat -> return the existing hold (repeat request, see 5.3)
   - otherwise -> return "already has a hold" (FR-10)
2. If `hold:{eventId}:{seatId}` exists -> return "taken" (409, FR-8).
3. Otherwise set both keys with the 5-minute expiry -> return "ok".

Releasing a hold (FR-11) is also a script: delete both keys only if the stored
owner is the caller. Otherwise a late release could delete someone else's hold.

### 6.3 Payment in progress

When Pay is clicked, the app (after saving the `started` payment in PostgreSQL)
extends both hold keys once, to payment timeout + a safety margin. A hold's
expiry is handled by Redis itself, so expired seats become free automatically
(NFR-14). After a Redis restart the extension is lost, and section 5.2 covers
that case.

### 6.4 Seat-map cache

- The map is built from PostgreSQL (booked seats) plus one `MGET` over the
  event's hold keys (held seats). Everything else is available.
- The result is cached for 2 seconds. A stale map is harmless, because the
  hold step is the real authority and a stale click just gets a 409.
- No manual invalidation. The short expiry is the refresh rule.
- Cache stampede guard: on a miss, one request rebuilds (it takes a short
  `SET NX` lock) while others return the previous copy. Otherwise 5,000 users
  would hit PostgreSQL at once when the cache expires.
- Keep a second copy `seatmap:stale:{eventId}` with a 10-second life. Requests that lose the rebuild lock return this one.

### 6.5 Rate limiting

Each request increments a counter for its user and its IP in the current
second. Over the limit (NFR-16) -> 429. Counters expire on their own. In
benchmarks the IP limit is raised (A-5).

### 6.6 Restart marker

On startup the app checks `redis:boot`. If missing, Redis was wiped: run the
rebuild from 5.2, then set the marker.
