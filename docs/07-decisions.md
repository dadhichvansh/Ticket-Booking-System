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

## D-9: Login token is a signed token (JWT), checked without a database

- Date: 2026-11-01
- Alternatives: random session IDs stored in Redis; session IDs stored in PostgreSQL
- Why: app copies must stay stateless (03 section 4). A signed token is verified by any copy with a shared secret, and it does not break when Redis restarts (NFR-12).
- Trade-offs: a token cannot be cancelled before it expires (no logout list). Acceptable in v1, because roles, password reset and refresh tokens are out of scope.

## D-10: Rate limiter lets requests through if Redis is unreachable

- Date: 2026-11-01
- Alternatives: reject requests when Redis is down; keep counters in each app copy's memory
- Why: rejecting would create 5xx errors during a Redis restart (NFR-10, NFR-12). Per-copy counters would break the "stateless" rule and give wrong totals with 2+ copies.
- Trade-offs: during a Redis outage there is no rate limiting for a short time. The PostgreSQL constraints still guard correctness.

## D-11: Money is stored as whole rupees (INR), integers only

- Date: 2026-11-01
- Alternatives: paise as the smallest unit (what real payment gateways use); decimal/NUMERIC; floats
- Why: v1 has no fractional prices, tax, coupons or partial refunds, so whole rupees are enough and need no conversion. Integers avoid float rounding bugs.
- Trade-offs: if fractional amounts are ever needed, columns must be migrated to paise. A real gateway integration (parking lot item 4) would also need paise.

## D-12: Passwords are hashed with argon2

- Date: 2026-11-04
- Alternatives: bcrypt
- Why: argon2 is a modern password hash with no 72-byte input limit, and FR-3 only requires "hashed"
- Trade-offs: it uses memory as well as CPU, so test users must be logged in gradually in Phase 4

## D-13: After Redis grants a hold, the app checks PostgreSQL for a booking

- Date: 2026-11-04
- Alternatives: keep a "booked" set in Redis; do the PostgreSQL check before Redis for every request
- Why: a confirmed booking deletes the hold key, so Redis alone cannot know the seat is booked (FR-8). Checking after the Redis step means only winners cost one indexed query, and losers still get a fast 409 (NFR-8).
- Trade-offs: requests for already-booked seats still reach PostgreSQL. If Phase 4 shows this hurts, add a "booked" flag in Redis and log a new decision.

## D-14: Hold requests also use the idempotency table in PostgreSQL

- Date: 2026-11-04
- Alternatives: rely only on Redis (a repeat by the same user for the same seat returns the same hold)
- Why: FR-23 names hold explicitly, and 03 section 5.3 says all three endpoints use the same mechanism
- Trade-offs: each hold request adds PostgreSQL writes on the hot path, which could threaten NFR-7. Measure in Phase 4. If it fails, revisit (for example, keep hold keys in Redis only).

## D-15: While Redis is down, hold actions return 503 and PostgreSQL-only actions keep working

- Date: 2026-11-04
- Alternatives: fall back to holds in PostgreSQL; return 503 for everything
- Why: a second hold system during an outage could disagree with Redis after it returns (NFR-4). Cancel and my bookings need only PostgreSQL, so they should keep working (NFR-12).
- Trade-offs: users cannot take new holds during an outage. Seat-map fallback adds load on PostgreSQL for a short time.

## D-16: The mock payment service keeps its own independent record

- Date: 2026-11-04
- Alternatives: store mock charges in the app's PostgreSQL
- Why: NFR-2 and NFR-3 are about money moving. A separate record can prove it independently, and it survives a mock crash.
- Trade-offs: one more small storage to run and reset between tests

## D-17: No Prometheus or Grafana in v1; metrics are read from /metrics and k6

- Date: 2026-11-04
- Alternatives: add Prometheus and Grafana for second-by-second graphs; keep them in the Parking Lot
- Why: the proof I keep for interviews and my resume comes from k6 results and saved `/metrics` snapshots taken before and after each benchmark. Two more containers would also add load on an 12 GB machine and could distort results (NFR-20).
- Trade-offs: no graph of what happens second by second during the stampede or the failure tests. Only before and after totals, plus k6's own latency output.

## D-18: The naive baseline uses a `pending` booking row as its hold

- Date: 2026-11-05
- Alternatives: a separate holds table in PostgreSQL; a baseline with no holds at all
- Why: the schema already has `pending` and the unique index, so the baseline needs no extra table and still cannot double book (NFR-1). It gives an honest "before" for the Redis benchmark (D-3).
- Trade-offs: baseline-only code with a sweep query for expiry. It is deleted in M4. The final system never creates `pending` rows.

## D-19: Plain `pg` with hand-written SQL, no ORM

- Date: 2026-11-15
- Alternatives: Prisma; another ORM or query builder
- Why: the important parts of this system are raw SQL anyway: the partial unique indexes (D-6, D-7), guarded updates (`UPDATE ... WHERE status = 'confirmed'`) and `FOR UPDATE SKIP LOCKED` (04 outbox). An ORM would not remove that SQL and would add a second schema source next to `001_init.sql`. BIGINT ids come back from `pg` as strings, which matches the API (05 section 1). An ORM would also use extra RAM on an 12 GB machine (D-17).
- Trade-offs: row types are written by hand, and a column rename must be changed in the SQL and the type. No generated migrations; `001_init.sql` stays the only schema file.

## D-20: TypeScript, run with tsx in development and built with tsc

- Date: 2026-11-15
- Alternatives: plain JavaScript; ts-node
- Why: types catch mistakes around ids (string) and money (integer) before they run. `tsx` starts fast and needs no build step in development. `tsc` builds the version that runs in Docker later. `strict` and `noUncheckedIndexedAccess` are on.
- Trade-offs: a build step for the container image; relative imports must end in `.js` (NodeNext).

## D-21: Three layers: routes, controllers, services

- Date: 2026-11-15
- Alternatives: all logic inside route files; only routes and services
- Why: routes only map paths, controllers only read the request and send the response (no SQL), services hold the logic and SQL (no `req` or `res`). Services can later be called from the worker without Express (M6).
- Trade-offs: three files per feature, which is more typing for small endpoints.

## D-22: `not_found` error code, `rememberBase`, and trailing-slash fix for route labels

- Date: 2026-11-15
- Alternatives: let Express send its default 404 page; log the real URL as the route label
- Why: unknown routes must use the same error format as every other error (05 section 1), so `not_found` (404) was added. Express resets `req.baseUrl` when an error happens, so `rememberBase` saves it first and the logger can build full route patterns such as `/api/events/:eventId` for errors too. The logger removes a trailing slash, so the list route is `/api/events` and not `/api/events/`. Metrics in M8 need `route` to be a pattern, never a real URL (05 section 10.2).
- Trade-offs: each mounted router needs `rememberBase`. Requests that fail before a route matches (for example broken JSON) log `route: "unmatched"`.

## D-23: The mock payment service stores its data in SQLite (better-sqlite3) on a Docker volume

- Date: 2026-11-16
- Alternatives: JSON file; append-only log file; `node:sqlite` (experimental in Node 22); Redis; a second PostgreSQL
- Why: the mock is the independent witness for NFR-2 and NFR-3 (D-16), so every charge and refund must be on disk before it replies. SQLite gives atomic transactions, and `UNIQUE` on `payment_key` and `refund_key` makes "same key twice, one charge" a database rule. A JSON file would need hand-written atomic writes and locking. Redis is restarted in failure test F4, and a second PostgreSQL costs too much RAM (D-17).
- Trade-offs: `better-sqlite3` is a native package, so the Docker image uses a Debian-based Node image (not Alpine). Needs `journal_mode = WAL` and `synchronous = FULL` so that "written before reply" is real.

## D-24: The naive baseline lives in one folder, `src/baseline/`

- Date: 2026-11-22
- Alternatives: baseline code mixed into the normal routes, controllers and services
- Why: D-18 says the baseline is deleted in M4. One folder with one mount line in `app.ts` means deleting it cannot break real code. It has no Redis, no idempotency and no rate limit, because that is the "before" picture.
- Trade-offs: the baseline duplicates a little logic that the real flow will rewrite in M4 and M5.

## D-25: k6 runs on Windows, and the stampede users are created through real signup and login

- Date: 2026-11-22
- Alternatives: k6 in Docker; users inserted by SQL with minted tokens
- Why: Docker is limited to 6 GB (D-17), so k6 runs on the host. Real signup and login keeps the test honest and uses the same path a user would. Users are created in small batches (D-12).
- Trade-offs: setup is slow because argon2 uses CPU and memory. k6 shares the CPU with the app, and this is written in 09-benchmarks.md.

## D-26: The baseline pay endpoint writes naive `payments` rows

- Date: 2026-11-24
- Alternatives: baseline pay writes no `payments` row (smaller code)
- Why: with no `payments` rows, the NFR-2 audit queries would read an empty table and pass without checking anything. A naive row (call the mock first, then one transaction that confirms the booking and inserts the payment) lets the audit see the real gap, so benchmark B1 is an honest "before" for M5 and M6.
- Trade-offs: the baseline has no write-first step, no idempotency and no recovery job, so a crash or timeout after a successful charge can leave money taken with no booking. This is expected in B1 and is closed in M5 and M6. If a charge succeeds but the booking update changes 0 rows, the payment row is saved with `booking_id` NULL and the answer is `409 seat_lost`, so the audit can see it.

## D-27: The baseline cancel refunds inside the request and has no retry

- Date: 2026-11-24
- Alternatives: baseline cancel only changes the booking status and never calls the mock refund
- Why: without a refund call, the NFR-2 and NFR-3 audit queries would flag every cancelled booking and show nothing useful. With a naive refund call (cancel first, then refund, then one transaction that saves the refund row and sets `refunded`), the audit sees a real gap when the refund fails.
- Trade-offs: the refund happens inside the request, which the final design does not do (M5 and M6 use outbox rows and the worker). If the refund fails or the result is unknown, the booking stays `cancelled` with no `refunds` row and nothing retries. This is expected in B1 and is closed in M5 and M6.
