# 05 - API Spec

Status: IN PROGRESS (Step 1 of N: conventions, auth, browsing)
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
| 400       | Bad input (`validation_error`)                                                            |
| 401       | Missing, invalid or expired token, or wrong login                                         |
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

| Needs NO token                                      | Needs a token                                             |
| --------------------------------------------------- | --------------------------------------------------------- |
| signup, login, list events, event details, seat map | everything else (hold, release, pay, cancel, my bookings) |

## 3. Endpoints in this step

### 3.1 POST /api/auth/signup (FR-1, FR-3)

Request:

```json
{ "email": "asha@example.com", "password": "my-long-password" }
```

Rules:

- Email: trimmed, lowercased, simple format check, at most 254 characters.
- Password: 8 to 72 characters (bcrypt only uses the first 72 bytes).
- Password is hashed with bcrypt before saving. Never stored or logged in plain text.

Success `201`:

```json
{ "user": { "id": "17", "email": "asha@example.com" } }
```

Errors: `400 validation_error`, `409 email_taken`, `429 rate_limited`.

Note: `email_taken` tells a stranger that an email exists. This is accepted for v1,
because password reset and account recovery are out of scope.

### 3.2 POST /api/auth/login (FR-2)

Request: same body as signup.

Success `200`:

```json
{
  "token": "<signed token>",
  "expiresInSeconds": 3600,
  "user": { "id": "17", "email": "asha@example.com" }
}
```

Errors: `400 validation_error`, `401 invalid_credentials`, `429 rate_limited`.

- Wrong email and wrong password give the **same** error, so nobody can test which emails exist.
- Only per-IP rate limiting applies here (there is no user yet).

**Token (D-9):** a signed token (JWT) holding the user id and an expiry (default 1 hour,
configurable). The secret comes from an environment variable shared by all app copies.
No refresh tokens (out of scope). Because the token is checked by signature, any app copy
can verify it without Redis or PostgreSQL.

### 3.3 GET /api/events (FR-4), no token

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

### 3.4 GET /api/events/:eventId (FR-4), no token

Success `200`: one object with the same fields as above.
Errors: `400 validation_error` (id is not a number), `404 event_not_found`.

### 3.5 GET /api/events/:eventId/seats (FR-5), no token

This is the seat map. It is the most-read endpoint during the stampede (NFR-6).

Success `200`:

```json
{
  "eventId": "1",
  "generatedAt": "2026-12-01T10:00:02Z",
  "seats": [
    { "id": "101", "row": "A", "number": 1, "status": "available" },
    { "id": "102", "row": "A", "number": 2, "status": "held" },
    { "id": "103", "row": "A", "number": 3, "status": "booked" }
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

Step 2 adds: `seat_taken`, `already_has_hold`, `hold_not_active`, `request_in_progress`,
`idempotency_mismatch`, `booking_not_found`, `booking_not_cancellable`.

## 5. Notes for the load test (Phase 4)

- Signup and login are slow on purpose (password hashing uses CPU). They are NOT part of the stampede.
- The test setup creates the 5,000 users and logs them in BEFORE the 10-second window starts,
  then reuses the tokens. Set the token expiry long enough for the whole run.

## 6. Still open (decided in a later step)

- What each endpoint does while Redis is down or restarting (needed for failure test 4).
