# Change Log

All notable changes to this project are documented in this file.

## Requirements changes (scope-freeze audit trail)

| Date       | Reason                                                                              | Impact                                                 |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-10-29 | Requirements frozen at v1.0                                                         | Scope, FR-1 to FR-30, NFR-1 to NFR-20 are the contract |
| 2026-10-29 | Rate limit per IP would block the load test                                         | Added A-5, A-6                                         |
| 2026-10-29 | FR-16 needed a booking state before "confirmed"                                     | Rewrote section 2.9                                    |
| 2026-10-29 | FR-22 could end with a payment and no refund                                        | Added the dead-letter rule                             |
| 2026-10-29 | FR-5, FR-7, FR-10 were unclear                                                      | Clarified the wording only                             |
| 2026-10-29 | FR-2 did not match the public seat map in FR-5                                      | Clarified FR-2 wording only                            |
| 2026-10-29 | Problem statement said a failed payment releases the hold, which contradicted FR-15 | Updated 01-problem-statement.md, wording only          |

## Application changes

| Date       | Milestone | Change                                                                                                                                                                                                 |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-15 | M1        | App skeleton (Express 5, TypeScript, config, JSON logs, correlation ID, error format), signup, login with JWT, event list, event details, seat map from PostgreSQL, `/health/live` and `/health/ready` |
