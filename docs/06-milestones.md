# 06 - Milestones

Status: COMPLETE

Requirements: v1.0 (frozen)

## Rules for every milestone

- A milestone is DONE only when every check under "Done when" passes. No partial credit.
- Do not start the next milestone before the current one is done (strict order).
- At the end of each milestone: commit, and add one row to CHANGELOG "Application changes".
- Any new idea goes to 08-parking-lot.md, not into the current milestone.
- Every benchmark follows NFR-20: record machine specs, scenario, date and exact commands in
  09-benchmarks.md, and save the k6 summary and `/metrics` snapshots in `benchmarks/`.
  Never write a number that was not measured.
- Assumption: M0 is Phase 3 (setup). M1 onward is Phase 4 (build and test).

## Overview

| #   | Milestone                                                     | Main requirements                            | Benchmark     |
| --- | ------------------------------------------------------------- | -------------------------------------------- | ------------- |
| M0  | Setup: Docker, Postgres, schema, seed                         | NFR-19, 04                                   | none          |
| M1  | App skeleton, auth, browsing                                  | FR-1 to FR-5, NFR-18                         | none          |
| M2  | Mock payment service                                          | A-2, 05 section 8                            | none          |
| M3  | Naive baseline (database only) + load test and audit scripts  | NFR-1                                        | B1 (break it) |
| M4  | Redis: holds, seat-map cache, rate limits                     | FR-6 to FR-11, FR-29, NFR-6 to NFR-8, NFR-14 | B2            |
| M5  | Full pay flow, idempotency, cancel and refund records         | FR-12 to FR-23, NFR-2, NFR-3                 | none          |
| M6  | RabbitMQ and worker: outbox, notifications, refunds, recovery | FR-22, FR-24 to FR-28, NFR-13                | B3            |
| M7  | Scale: 2+ app copies behind Nginx                             | NFR-15                                       | B4            |
| M8  | Metrics and logs                                              | FR-30, NFR-17, NFR-18                        | none          |
| M9  | Simple React page                                             | 02 section 1.1                               | none          |
| M10 | Failure tests (4 tests from 03 section 5.5)                   | NFR-4, NFR-11 to NFR-13                      | F1 to F4      |
| M11 | Final benchmarks and cleanup                                  | NFR-5 to NFR-10, NFR-19, NFR-20              | final         |

## M0: Setup

Do: install Docker Desktop, set the WSL2 memory limit (`.wslconfig`),
write `docker-compose.yml` with PostgreSQL, write the migration file from 04, write seed data (A-4).

Done when:

- [ ] `docker compose up` starts PostgreSQL and the seed data loads.
- [ ] All proof tests in 04 (Steps 1 to 3) pass.
- [ ] Docker version and Docker memory limit are filled in 09-benchmarks.md.

## M1: App skeleton, auth, browsing

Do: Express app, config from environment variables, correlation ID, JSON logs, error format (05 section 1),
signup, login, events, event details, seat map (from PostgreSQL only, no cache yet), `/health/live`, `/health/ready`.
Done when:

- [ ] Every endpoint in 05 sections 3 and 10.1 behaves as written, including error codes.
- [ ] Passwords are stored hashed (check the table by hand).
- [ ] Every response and every log line carries the correlation ID.

## M2: Mock payment service

Do: build the service from 05 section 8 as its own container, with its own storage on a Docker volume.
Done when:

- [ ] Same `paymentKey` twice charges once; same `refundKey` twice refunds once.
- [ ] `GET /charges/:key` returns `404` for an unknown key.
- [ ] Each `chargeMode` works, including `timeout_after_charge` and `crash_after_charge`.
- [ ] `/admin/ledger` and `/admin/reset` work, and the ledger survives a restart of the mock.

## M3: Naive baseline (database only) and test tools

Do:

- A throwaway database-only version of hold, pay and cancel. The hold is a `pending` booking
  row (the unique index decides who wins). A small sweep query cancels `pending` rows older than 5 minutes.
  This is a baseline only and is replaced in M4 (D-18).
- The k6 stampede script (NFR-5): 5,000 users, 200 seats, 10 seconds. Users are created and logged in
  BEFORE the window, in small batches (D-12).
- One script that runs the settle check and the NFR-1 to NFR-4 queries from 04 Step 4.

Done when:

- [ ] The stampede script runs end to end and the audit script prints results.
- [ ] Benchmark B1 is recorded in 09-benchmarks.md: what held, what broke, which NFR targets were missed.
      Failing targets here is expected and useful. It is the "before" picture.
- [ ] NFR-1 query returns 0 rows even in the naive version (the index guarantees it).

## M4: Redis

Do: replace the baseline hold with the Lua script (D-5), add the D-13 PostgreSQL check, hold release,
`GET` and `DELETE /api/holds/me`, seat-map cache with stale copy and rebuild lock (D-4), rate limits (D-10),
restart marker and rebuild (03 section 5.2, 05 section 9).

Done when:

- [ ] Two users racing for one seat: exactly one gets `201`, the other gets `409` with no PostgreSQL work.
- [ ] One hold per user across events (FR-10). A hold expires on its own (FR-9, NFR-14: within 10 seconds of expiry).
- [ ] A booked seat cannot be held (D-13).
- [ ] 429 appears when limits are crossed (own rate-limit test, A-5).
- [ ] With Redis stopped, each endpoint behaves as the table in 05 section 9 says.
- [ ] Benchmark B2 recorded and compared with B1. Remove the baseline code.

## M5: Full pay flow, idempotency, cancel and refund records

Do: idempotency table and rules (05 section 7.1), payment record before the charge (write first, act second),
pay endpoint with all four results (`201`, `409 seat_lost`, `402`, `202`), cancel in one transaction
with refund row and two outbox rows, my bookings. Outbox rows are written here; nothing sends them yet.

Done when:

- [ ] Double-click on hold, pay and cancel with the same key: one side effect, same answer, `Idempotent-Replay: true`.
- [ ] Same key with a different body gives `422`.
- [ ] Seat-lost case produces a `cancelled` booking, a refund row and two outbox rows (04 notes).
- [ ] The mock ledger agrees with the database (04 Step 4, NFR-2 and NFR-3 checks) on a small manual run.

## M6: RabbitMQ and worker

Do: RabbitMQ container, outbox sender (`FOR UPDATE SKIP LOCKED`), notification consumer with
`ON CONFLICT DO NOTHING`, refund consumer with wait queues (5s, 30s, 2 min, 10 min), limit 5, dead-letter queue,
and the recovery job (every ~30s) from 03 section 5.1 and 5.4.

Done when:

- [ ] Refund fails twice then succeeds (`refundFailUntilAttempt`): exactly one refund in the mock ledger.
- [ ] Refund that never succeeds ends as `dead`, booking stays `refund_failed`, recovery does not re-send it.
- [ ] `timeout_after_charge`: recovery finishes the payment (booking, or refund) within about 60 to 90 seconds.
- [ ] Stop the worker, make bookings, start the worker: every notification arrives exactly once.
- [ ] Benchmark B3 recorded (stampede with queue and worker running).

## M7: Scale

Do: 2 app copies behind Nginx (gzip on the seat map), each reachable on its own for `/metrics`.

Done when:

- [ ] The stampede runs with 2 copies and the NFR-1 to NFR-4 queries all return 0 rows.
- [ ] Benchmark B4 recorded next to B3 (1 copy vs 2 copies).

## M8: Metrics and logs

Do: `/metrics` with the table in 05 section 10.2 on every app copy and the worker. No Prometheus or Grafana (D-17).

Done when:

- [ ] The metrics in the table exist and move when you make requests.
- [ ] `route` labels use patterns, not real URLs.
- [ ] A script saves a `/metrics` snapshot from every copy before and after a run into `benchmarks/`.

## M9: Simple React page

Do: one page: events, seat map, hold with countdown, pay, my bookings, cancel. Each click sends a new idempotency key.

Done when:

- [ ] You can complete hold, pay, see the booking, and cancel from the page.
- [ ] After a page refresh, the hold is restored from `GET /api/holds/me`.

## M10: Failure tests (03 section 5.5)

Run each DURING the stampede, then wait for settling, then run the settle check and the NFR-1 to NFR-4 queries:

1. F1: stop the worker, then restart it.
2. F2: stop RabbitMQ, then restart it.
3. F3: kill one app copy.
4. F4: restart Redis.
   Done when:

- [ ] For each test: all audit queries return 0 rows and the mock ledger agrees with the database.
- [ ] No notification lost or duplicated in F1 and F2.
- [ ] 503s during F4 are expected and recorded as such (05 section 9). They are not NFR-10 failures.
- [ ] If F4 fails, D-2 is reopened.

## M11: Final benchmarks and cleanup

Done when:

- [ ] The stampede measured against NFR-6 to NFR-10 on the final system; each target marked met or not met, honestly.
- [ ] 09-benchmarks.md has machine specs, scenario, date and exact commands for every run (NFR-20).
- [ ] A fresh clone with one `docker compose up` works, including seed data (NFR-19).
- [ ] README explains how to run the system, the tests and the benchmarks.
- [ ] If a target is not met, write why and what you would change. Do not change the requirement.

## If a milestone gets stuck

Write the problem in 07-decisions.md or the CHANGELOG (whichever fits). Do not skip ahead
and do not change requirements. A requirement changes only if it is a genuine bug (contradiction or impossible).
