# 07 - Decisions

## D-1: Add cancellation/refund and mock notifications to v1

- Alternatives: keep both out of v1 (parking lot); use a real email/SMS provider
- Why: exercise idempotency, state machines, and queue failure handling (stated learning goals)
- Trade-offs: v1 grows by about two milestones; constrained to full refunds and mock sender
- Date: 2026-10-12

## D-2: Holds may be lost on Redis restart; bookings may not

- Alternatives: persist holds in PostgreSQL as the source of truth; Redis persistence (AOF)
- Why: holds are short-lived (5 min) and the DB is the source of truth for confirmed bookings
- Trade-offs: after a Redis restart, some users lose their hold and must retry; recovery logic must be correct (NFR-12, NFR-4)
- Date: 2026-10-29
- Status: open. Will be defended or revised in Phase 2.
