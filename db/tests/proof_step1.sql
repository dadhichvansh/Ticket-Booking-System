-- Proof test Step 1: double-booking guard (NFR-1, FR-20)
-- Everything is rolled back at the end. Nothing is saved.
BEGIN;

INSERT INTO users (email, password_hash) VALUES ('proof1@example.com', 'x');

\echo '--- Test 1: insert confirmed booking for seat 1. Expect: INSERT 0 1'
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof1@example.com'), 1, 1, 'confirmed');

\echo '--- Test 2: second confirmed booking for seat 1. Expect: ERROR 23505'
\set VERBOSITY verbose
SAVEPOINT t2;
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof1@example.com'), 1, 1, 'confirmed');
ROLLBACK TO t2;
\set VERBOSITY default

\echo '--- Test 3: cancel the first booking. Expect: UPDATE 1'
UPDATE bookings SET status='cancelled' WHERE seat_id=1 AND status='confirmed';

\echo '--- Test 4: new confirmed booking for seat 1. Expect: INSERT 0 1'
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof1@example.com'), 1, 1, 'confirmed');

\echo '--- Test 5: two more cancelled bookings for seat 2. Expect: INSERT 0 1 twice'
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof1@example.com'), 1, 2, 'cancelled');
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof1@example.com'), 1, 2, 'cancelled');

ROLLBACK;
