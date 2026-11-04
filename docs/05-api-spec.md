# 05 - API Spec

Status: COMPLETE (Step 4: coverage check done)

Requirements: v1.0 (frozen)

## 1. Conventions

- **Base path:** `/api`. JSON only (`Content-Type: application/json`).
- **Field names:** camelCase in JSON (the database uses snake_case; the app converts).
- **IDs are strings** in JSON, for example `"id": "42"`. PostgreSQL BIGINT can be larger
  than a JavaScript number holds safely, and the Postgres driver returns BIGINT as a string anyway.
- **Times:** ISO 8601 in UTC, for example `"2026-12-05T18:30:00Z"`.
- **Money:** whole integers in rupees. Field names end in `Rupees`.
- **Token:** `Authorization: Bearer <token>`.
- **Idempotency key:** `Idempotency-Key: <random id>` header on hold, pay and cancel (FR-23). Details in Step 2.
- **Correlation ID (NFR-18):** the client may send `X-Correlation-Id`. If it is missing,
  too long (over 100 characters) or has odd characters, the server makes a new UUID.
  The ID is returned in the `X-Correlation-Id` response header, inside every error body,
  and in every log line.

### Error format (same for every error)

```json
{
  "error": {
    "code": "seat_taken",
    "message": "Human readable text",
    "correlationId": "7f3c..."
  }
}
```

`code` is for programs (stable). `message` is for people (can change).

### Status codes used

| Code      | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| 200 / 201 | OK / created                                                                              |
| 202       | Accepted, still being processed (`payment_pending`)                                       |
| 400       | Bad input (`validation_error`)                                                            |
| 401       | Missing, invalid or expired token, or wrong login                                         |
| 402       | Payment failed (`payment_failed`). Expected about 10% of the time (A-2), not a 5xx        |
| 404       | Not found                                                                                 |
| 409       | Conflict (email taken, seat taken, request in progress, ...)                              |
| 422       | Same idempotency key used for a different request (reserved for this, see 03 section 5.3) |
| 429       | Too many requests, with header `Retry-After: 1` (FR-29)                                   |
| 500 / 503 | Our fault. These are the "unexpected errors" counted in NFR-10                            |

### Order of checks on every request

1. Correlation ID
2. Per-IP rate limit (cheap, before any work)
3. Token check (only on endpoints that need it)
4. Per-user rate limit
5. Idempotency key claim (hold, pay, cancel only, Step 2)
6. The real work

### Rate limiting when Redis is down (D-10)

Rate-limit counters live in Redis. If Redis cannot be reached, the limiter **lets the
request through** and logs a warning. Otherwise a Redis restart would turn every request into a 5xx
and break NFR-10 and NFR-12.

## 2. Which endpoints need a token (FR-2)

| Needs NO token                                                               | Needs a token                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| signup, login, list events, event details, seat map, `/health/*`, `/metrics` | everything else (hold, release, pay, cancel, my bookings) |

Health and metrics are not user actions, and they are not reachable through Nginx (10.1, 10.2).

## 3. Endpoints in this step

### 3.1 POST `/api/auth/signup` (FR-1, FR-3)

Request:

```json
{
  "email": "john.doe@example.com",
  "password": "my-long-password"
}
```

Rules:

- Email: trimmed, lowercased, simple format check, at most 254 characters.
- Password: 8 to 72 characters.
- Password is hashed with argon2 before saving. Never stored or logged in plain text.

Success `201`:

```json
{
  "user": {
    "id": "17",
    "email": "john.doe@example.com"
  }
}
```

Errors: `400 validation_error`, `409 email_taken`, `429 rate_limited`.

Note: `email_taken` tells a stranger that an email exists. This is accepted for v1,
because password reset and account recovery are out of scope.

### 3.2 POST `/api/auth/login` (FR-2)

Request: same body as signup.

Success `200`:

```json
{
  "token": "<signed token>",
  "expiresInSeconds": 3600,
  "user": {
    "id": "17",
    "email": "john.doe@example.com"
  }
}
```

Errors: `400 validation_error`, `401 invalid_credentials`, `429 rate_limited`.

- Wrong email and wrong password give the **same** error, so nobody can test which emails exist.
- Only per-IP rate limiting applies here (there is no user yet).

**Token (D-9):** a signed token (JWT) holding the user id and an expiry (default 1 hour,
configurable). The secret comes from an environment variable shared by all app copies.
No refresh tokens (out of scope). Because the token is checked by signature, any app copy
can verify it without Redis or PostgreSQL.

### 3.3 GET `/api/events` (FR-4), no token

Success `200`:

```json
{
  "events": [
    {
      "id": "1",
      "name": "Rock Night",
      "startsAt": "2026-12-05T18:30:00Z",
      "priceRupees": 500,
      "totalSeats": 200
    }
  ]
}
```

No pagination: v1 has only a few seeded events (A-4). `totalSeats` is counted from the `seats` table.

### 3.4 GET `/api/events/:eventId` (FR-4), no token

Success `200`: one object with the same fields as above.

Errors: `400 validation_error` (id is not a number), `404 event_not_found`.

### 3.5 GET `/api/events/:eventId/seats` (FR-5), no token

This is the seat map. It is the most-read endpoint during the stampede (NFR-6).

Success `200`:

```json
{
  "eventId": "1",
  "generatedAt": "2026-12-01T10:00:02Z",
  "seats": [
    {
      "id": "101",
      "row": "A",
      "number": 1,
      "status": "available"
    },
    {
      "id": "102",
      "row": "A",
      "number": 2,
      "status": "held"
    },
    {
      "id": "103",
      "row": "A",
      "number": 3,
      "status": "booked"
    }
  ]
}
```

Rules:

- `status` is only `available`, `held` or `booked` (FR-5).
- `booked` = a `pending` or `confirmed` booking exists. `held` = a hold key exists in Redis.
- The map **never shows who** holds or owns a seat. The client already knows its own hold
  from the hold response (Step 2).
- Seats are sorted by `row`, then `number`.
- `generatedAt` is when the cached copy was built (up to 2 seconds old, D-4; the
  10-second stale copy can be older). A stale map is allowed, because the hold step decides.
- Response header `Cache-Control: no-store`, so the browser does not add its own cache on top of ours.
- Nginx should compress this response (gzip). Measure the real size later in Phase 4; do not guess.
- If Redis is down, the map is built from PostgreSQL only and the response has "holdsKnown": false (see section 9).

Errors: `400 validation_error`, `404 event_not_found`, `429 rate_limited`.

## 4. Error codes so far

| Code                                    | HTTP |
| --------------------------------------- | ---- |
| validation_error                        | 400  |
| invalid_credentials                     | 401  |
| unauthorized (token missing or invalid) | 401  |
| token_expired                           | 401  |
| event_not_found                         | 404  |
| email_taken                             | 409  |
| rate_limited                            | 429  |
| internal_error                          | 500  |

Added in Step 2:

| Code                    | HTTP |
| ----------------------- | ---- |
| seat_not_found          | 404  |
| booking_not_found       | 404  |
| seat_taken              | 409  |
| already_has_hold        | 409  |
| hold_not_active         | 409  |
| payment_in_progress     | 409  |
| seat_lost               | 409  |
| request_in_progress     | 409  |
| booking_not_cancellable | 409  |
| idempotency_mismatch    | 422  |
| payment_failed          | 402  |
| service_unavailable     | 503  |

## 5. Notes for the load test (Phase 4)

- Signup and login are slow on purpose (password hashing uses CPU). They are NOT part of the stampede.
- The test setup creates the 5,000 users and logs them in BEFORE the 10-second window starts,
  then reuses the tokens. Set the token expiry long enough for the whole run.

## 6. Still open (decided in a later step)

- What each endpoint does while Redis is down or restarting (needed for failure test 4).

## 7. Step 2: holds, payment, cancel, my bookings

All endpoints here need a token (FR-2).

### 7.1 Idempotency rules (hold, pay, cancel) (FR-23)

- Header `Idempotency-Key` is **required**: 8 to 100 characters, letters, digits, `-` and `_`
  (a UUID is fine). Missing or bad key gives `400 validation_error`.
- The server makes a **fingerprint** = hash of HTTP method + path + body.
- Input shape is checked (400) _before_ the claim, so bad requests never create keys.
  Rate limit (429) and token (401) also come before it.

| Situation                                   | Result                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Key is new                                  | Claim it (insert `in_progress`), do the work, save the answer, mark `done`            |
| Key exists, different fingerprint           | `422 idempotency_mismatch` (checked first)                                            |
| Key exists, `done`, same fingerprint        | Return the saved status and body again, no work. Add header `Idempotent-Replay: true` |
| Key exists, `in_progress`, same fingerprint | `409 request_in_progress` with `Retry-After: 1`                                       |
| Key `in_progress` for more than 2 minutes   | Take it over (guarded update from 04) and do the work                                 |

- **What is saved:** every final answer, including business answers like `seat_taken`
  and `payment_failed`, and the `202 payment_pending`. The same click always gets the same answer.
- **What is not saved:** any 5xx. The claim row is deleted so a retry can run again. If the app
  crashes before it can delete the row, the 2-minute takeover covers it.
- **To try again after `payment_failed`, the client must use a NEW key** (a new click).
  The same key only replays the saved 402.
- Keys belong to one user (`UNIQUE (user_id, idem_key)`). The worker may delete keys older than
  24 hours (cleanup only, not needed for correctness).

### 7.2 POST `/api/holds` (FR-6 to FR-10)

Headers: `Idempotency-Key`.

Request:

```json
{
  "eventId": "1",
  "seatId": "101"
}
```

Steps:

1. Check the seat belongs to the event (one indexed lookup on `seats`). If not, `404 seat_not_found`.
   If Phase 4 shows this lookup is slow, cache seat ids in memory (seeded seats never change).
2. Run the Redis hold script (03 section 6.2).
3. If Redis said yes, check PostgreSQL for an active booking on this seat (D-13).
   If one exists, release the hold (owner-checked) and return `409 seat_taken`.

Success `201` (new hold) or `200` (same user, same seat, hold already exists):

```json
{
  "hold": {
    "eventId": "1",
    "seatId": "101",
    "expiresAt": "2026-12-01T10:05:02Z",
    "expiresInSeconds": 300
  }
}
```

Errors: `400 validation_error`, `404 seat_not_found`, `409 seat_taken` (held by someone else
or booked, FR-8), `409 already_has_hold` (user has a hold on another seat, FR-10),
`409 request_in_progress`, `422 idempotency_mismatch`, `429 rate_limited`.

Losers are answered by Redis alone, with no PostgreSQL work (NFR-8).

### 7.3 GET `/api/holds/me` and DELETE `/api/holds/me` (FR-11)

These do not need an idempotency key: both are safe to repeat.

**GET** returns the user's current hold, read from Redis (`userhold:{userId}` and the key's remaining life).
Without it, a page refresh would lose the user's hold. It adds no new data or requirement.

```json
{
  "hold": {
    "eventId": "1",
    "seatId": "101",
    "expiresAt": "...",
    "expiresInSeconds": 212
  }
}
```

`{ "hold": null }` when the user has none.

**DELETE** releases the user's own hold with the owner-checked release script.

Success `200`: `{ "released": true }`, or `{ "released": false }` if there was nothing to release.

Error: `409 payment_in_progress` if a payment for this hold is `started`
(releasing then would only cause a pointless refund later).

### 7.4 POST `/api/payments` (FR-12 to FR-16)

Headers: `Idempotency-Key`.

Request (the client says which seat it is paying for, so a
payment is always tied to a specific hold, FR-16):

```json
{
  "eventId": "1",
  "seatId": "101"
}
```

Steps (same as 03 Flow 3):

1. Read the Redis hold. It must exist, belong to this user, and match the event and seat.
   Otherwise `409 hold_not_active`. No payment record is created (FR-13, 03 section 5.2).
2. Insert a `payments` row: status `started`, server-made `payment_key`, amount = the event's
   `priceRupees`. If the unique "in flight" index rejects it, return `409 payment_in_progress`.
3. Extend the hold to at least now + payment timeout + 30 seconds (never shorten it).
   Payment timeout default is 5 seconds, configurable.
4. Call the mock payment service with the `payment_key` and `amountRupees` (whole rupees).
5. Handle the result:

| Result                              | HTTP                 | What happened                                                                                                                     |
| ----------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Success, booking saved              | `201`                | `{ "booking": { ... } }`, see 7.6 for the booking shape. Hold released, notification queued                                       |
| Success, but seat was taken         | `409 seat_lost`      | Booking saved as `cancelled`, refund started, user notified (FR-16). It will show as `refunded` in My bookings                    |
| Payment failed                      | `402 payment_failed` | Hold stays, user may retry with a new key (FR-15)                                                                                 |
| Timeout, no answer, or mock crashed | `202`                | Body `{ "status": "payment_pending", "message": "..." }`. The recovery job finishes it in about 60 to 90 seconds (03 section 5.1) |

After a `202`, the client tells the user: "We are confirming your payment. Check My bookings in
a minute. If nothing appears, no money was taken." A new payment for the same seat is
refused with `409 payment_in_progress` until the recovery job settles it (D-7).

**Repeating a `202` request:** the same key returns the same saved `202`, even after the
recovery job has finished the payment. The client must not retry the payment. It should
read `GET /api/bookings` to see the real result (`confirmed`, or `cancelled` then `refunded`).
If nothing appears after the recovery time, no money was taken.

Other errors: `400 validation_error`, `409 request_in_progress`, `422 idempotency_mismatch`, `429 rate_limited`.

### 7.5 POST `/api/bookings/:bookingId/cancel` (FR-18 to FR-21)

Headers: `Idempotency-Key`.

No body.

Steps (03 section 5.4): in ONE transaction, run the guarded update
`status 'confirmed' -> 'cancelled'` (only for this user's booking), insert a `refunds` row
(`pending`, unique `refund_key`), and insert two outbox rows (`refund_needed`, `notify_cancelled`).
After commit, send the jobs to RabbitMQ. The seat is free as soon as the commit succeeds (FR-20).

Success `200`: `{ "booking": { ... } }` with `status: "cancelled"`. The refund runs in the
background, and the status later becomes `refunded` (or `refund_failed`, FR-22).

Errors: `404 booking_not_found` (also used for someone else's booking, so ids cannot be probed),
`409 booking_not_cancellable` (status is not `confirmed`, for example a double-click with a different key),
`409 request_in_progress`, `422 idempotency_mismatch`, `429 rate_limited`.

### 7.6 GET `/api/bookings` (FR-17)

Returns the user's own bookings, newest first, at most 50 (uses the `idx_bookings_user` index).

```json
{
  "bookings": [
    {
      "id": "9001",
      "eventId": "1",
      "eventName": "Rock Night",
      "startsAt": "2026-12-05T18:30:00Z",
      "seat": {
        "id": "101",
        "row": "A",
        "number": 1
      },
      "status": "confirmed",
      "priceRupees": 500,
      "createdAt": "2026-12-01T10:03:10Z"
    }
  ]
}
```

- `status` is one of `confirmed`, `cancelled`, `refund_failed`, `refunded`.
  (`pending` exists in the database but the current flow never creates it.)
- `priceRupees` is the amount paid, read from the booking's payment row.
- The same booking object is used in the pay and cancel responses.

## 8. Mock payment service contract (internal)

This service is **not** reachable through Nginx. Only the app copies and the worker call it,
on the Docker network. All amounts are whole rupees (D-11). It exists so tests can make
money-movement failures happen on demand (A-2).

**Independent record:** it keeps its own storage (a file or SQLite on a Docker volume), NOT
the app's PostgreSQL. It writes each charge and refund to disk **before** replying, so the
record survives a crash. This makes it an independent witness for NFR-2 and NFR-3.

### 8.1 Charges

**POST `/charges`** `{ "paymentKey": "pay_abc", "amountRupees": 500 }`

- First time a key is seen: save it as `processing`, decide the result (success or fail,
  using `failureRate`), wait a random delay (50 to 2000 ms), save the result, reply.
- Same key again: no new charge. Return the saved result. Same key with a different amount: `422`.
- Replies: `200 { "status": "succeeded", "chargeId": "ch_1" }` or
  `200 { "status": "failed", "reason": "card_declined" }`.

**GET `/charges/:paymentKey`** (used by the recovery job, 03 section 5.1)

- `200 { "status": "processing" | "succeeded" | "failed" }`
- `404` = the service never received this key = not charged.
- The recovery job treats `processing` like "unknown": do nothing, try again next round.

### 8.2 Refunds

**POST `/refunds`** `{ "refundKey": "ref_abc", "paymentKey": "pay_abc", "amountRupees": 500 }`

- Only for a `succeeded` charge, and only for the full amount. Otherwise `422`.
- A **failed** attempt is not saved, so a retry with the same key tries again.
- A **successful** refund is saved forever. Any later call with the same key returns
  `200 { "status": "succeeded", "alreadyProcessed": true }` and moves no money (03 section 5.4, rule 4).
- Replies: `200 { "status": "succeeded" }` or `200 { "status": "failed", "reason": "..." }`.

**GET `/refunds/:refundKey`**: `200 { "status": "succeeded" }`, or `404` = no money was refunded.

### 8.3 Failure controls (test only)

**POST `/admin/config`**, any subset of:

| Setting                     | Default   | Meaning                                                                                                                                                                                             |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failureRate`               | 0.10      | share of charges that fail (A-2)                                                                                                                                                                    |
| `minDelayMs` / `maxDelayMs` | 50 / 2000 | reply delay (A-2)                                                                                                                                                                                   |
| `chargeMode`                | `normal`  | `normal`, `always_fail`, `timeout_after_charge` (charge saved, reply never sent), `crash_after_charge` (charge saved, then the process exits), `crash_before_charge` (exits before saving anything) |
| `refundFailureRate`         | 0         | share of refund attempts that fail                                                                                                                                                                  |
| `refundFailUntilAttempt`    | 0         | refunds for one key fail until this attempt number, then succeed (for FR-22 tests)                                                                                                                  |

**GET `/admin/ledger`** returns every charge and refund accepted, plus totals
(`chargeCount`, `refundCount`, `chargedRupees`, `refundedRupees`).

**POST `/admin/reset`** clears everything between test runs.

### 8.4 How the app calls it

- Timeout: 5 seconds (configurable). A timeout means "unknown", so the pay endpoint
  returns `202 payment_pending` (7.4) and never guesses.
- The app never retries a charge itself. The recovery job asks `GET /charges/:key` and decides.
- The NFR-2 and NFR-3 checks in 04 must agree with `/admin/ledger`:
  every charge there has a confirmed booking or a succeeded refund, and each `refundKey` appears once.

## 9. What each endpoint does while Redis is down (D-15)

Rule: **never invent a second source of truth.** If Redis is unreachable, anything that
needs holds says "try again", and anything that only needs PostgreSQL keeps working.

| Endpoint                             | While Redis is down or rebuilding                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Signup, login, events, event details | Works (PostgreSQL only)                                                                                   |
| Seat map                             | Built from PostgreSQL (booked seats only), not cached, `"holdsKnown": false`                              |
| POST /api/holds                      | `503 service_unavailable`, `Retry-After: 2`                                                               |
| GET and DELETE /api/holds/me         | `503 service_unavailable`                                                                                 |
| POST /api/payments                   | If no hold can be read: `503`, no payment created. A payment already `started` continues (03 section 5.2) |
| Cancel, my bookings                  | Works (PostgreSQL only)                                                                                   |
| Rate limiting                        | Lets requests through (D-10)                                                                              |

Details:

- **Releasing the hold after a booking is saved:** if the Redis call fails, log it and carry on.
  The booking is already saved, so the user still gets `201`. The hold key expires on its own,
  and the D-13 check stops anyone from holding that seat meanwhile.
- **503 and idempotency:** a 503 is a 5xx, so the claim row is deleted (7.1) and the client can retry with the same key.
- **After Redis comes back:** the first app copy to notice `redis:boot` is missing takes a lock
  (`SET NX`, 60 seconds) and runs the rebuild (03 section 5.2). Other copies answer holds with `503`
  until the marker is set. The rebuild re-holds seats that have a `started` payment (hold life =
  payment timeout + 30 seconds) and does nothing else.
- **For the failure tests:** these 503s are expected and are not NFR-10 failures. Failure
  test 4 checks NFR-1 to NFR-4 (correctness). Write this in `09-benchmarks.md` so the
  results are not misread.

## 10. Health and metrics

### 10.1 Health (no token, not rate limited, not counted in metrics)

- **GET `/health/live`**: `200 { "status": "ok" }`. No dependency checks. Used by Docker to restart a stuck process.
- **GET `/health/ready`**: checks PostgreSQL (`SELECT 1`, 1 second limit). Body shows `postgres`, `redis`
  and `rabbitmq` as `up` or `down`, but the status code depends on **PostgreSQL only**:
  `200` if up, `503` if down. Redis or RabbitMQ down must not remove a copy from rotation,
  because cancel and my bookings still work without them.

### 10.2 Metrics (FR-30, NFR-17)

**GET `/metrics`** in Prometheus text format (the `prom-client` package does this). Not exposed through Nginx.
Each app copy and the worker has its own `/metrics`, and counters reset when a process restarts.
In v1 you read them with `curl` before and after a benchmark and write the numbers in `09-benchmarks.md`.

| Metric                          | Type      | Labels                                                     |
| ------------------------------- | --------- | ---------------------------------------------------------- |
| `http_requests_total`           | counter   | method, route, status                                      |
| `http_request_duration_seconds` | histogram | method, route                                              |
| `holds_total`                   | counter   | result: `success`, `conflict`, `already_has_hold`, `error` |
| `payments_total`                | counter   | result: `confirmed`, `failed`, `seat_lost`, `pending`      |
| `refunds_total`                 | counter   | result: `succeeded`, `failed`, `dead`                      |
| `rate_limited_total`            | counter   | scope: `user`, `ip`                                        |
| `outbox_unsent`                 | gauge     | (worker)                                                   |
| `queue_depth`                   | gauge     | queue (worker, read from RabbitMQ)                         |

- `route` is the route **pattern** (`/api/events/:eventId/seats`), never the real URL, or the number of series explodes.
- `409` responses count as normal results (NFR-10). Latency percentiles (p95, p99) are computed from the histogram buckets.
- Every log line is JSON and includes `correlationId` (NFR-18).

## 11. Coverage check (Step 4)

| Requirement                       | Where it is covered                                                           |
| --------------------------------- | ----------------------------------------------------------------------------- |
| FR-1, FR-3                        | 3.1 signup, argon2 hashing (D-12)                                             |
| FR-2                              | 3.2 login, JWT (D-9), section 2 (token table)                                 |
| FR-4                              | 3.3, 3.4                                                                      |
| FR-5                              | 3.5 seat map                                                                  |
| FR-6, FR-7, FR-8, FR-10           | 7.2 hold (`seat_taken`, `already_has_hold`)                                   |
| FR-9                              | Redis expiry (03 section 6); `expiresAt` in the hold response                 |
| FR-11                             | 7.3 `DELETE /api/holds/me`                                                    |
| FR-12, FR-13, FR-14, FR-15, FR-16 | 7.4 pay (`hold_not_active`, `payment_failed`, `seat_lost`, `202`)             |
| FR-17                             | 7.6 my bookings                                                               |
| FR-18, FR-19, FR-20, FR-21        | 7.5 cancel (one transaction, unique refund key)                               |
| FR-22                             | 04 `refunds` (`failed`, `dead`) and 03 section 5.4; no API (see below)        |
| FR-23                             | 7.1 idempotency rules (hold, pay, cancel)                                     |
| FR-24, FR-25, FR-26, FR-27, FR-28 | 04 `outbox` and `notifications`; worker and RabbitMQ (03); no API (see below) |
| FR-29                             | `429 rate_limited` and the order of checks (section 1)                        |
| FR-30                             | 10.2 metrics (`holds_total` has success and failure counts)                   |

### Intentionally not in the API

- **Resolving a `dead` refund (FR-22):** done by a person directly in PostgreSQL and the
  mock service. Admin accounts and endpoints are out of scope (02 section 1.2).
- **Reading notifications (FR-26):** the mock sender writes to the `notifications` table.
  Tests check it with SQL (04, Step 4). There is no endpoint, because the requirement
  only says "records each notification to a table".
- **Logout, refresh tokens, password reset:** out of scope.
