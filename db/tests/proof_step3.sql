-- Proof test Step 3: idempotency keys, notifications, outbox
BEGIN;
\set VERBOSITY verbose

INSERT INTO users (email, password_hash) VALUES ('proof3@example.com', 'x');
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'), 1, 40, 'confirmed');

\echo '--- Test 1a: first idempotency key. Expect: INSERT 0 1'
INSERT INTO idempotency_keys (user_id, idem_key, endpoint, request_fingerprint, status)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'), 'key-12345678', 'hold', 'fp1', 'in_progress');

\echo '--- Test 1b: same (user, key). Expect: ERROR 23505'
SAVEPOINT t1;
INSERT INTO idempotency_keys (user_id, idem_key, endpoint, request_fingerprint, status)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'), 'key-12345678', 'hold', 'fp1', 'in_progress');
ROLLBACK TO t1;

\echo '--- Test 2: status done with no response_status. Expect: ERROR 23514 (check)'
SAVEPOINT t2;
INSERT INTO idempotency_keys (user_id, idem_key, endpoint, request_fingerprint, status)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'), 'key-87654321', 'pay', 'fp2', 'done');
ROLLBACK TO t2;

\echo '--- Test 3a: first notification. Expect: INSERT 0 1'
INSERT INTO notifications (user_id, booking_id, type, message)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'),
        (SELECT id FROM bookings WHERE seat_id=40), 'confirmed', 'hello');

\echo '--- Test 3b: same (booking, type). Expect: ERROR 23505'
SAVEPOINT t3;
INSERT INTO notifications (user_id, booking_id, type, message)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'),
        (SELECT id FROM bookings WHERE seat_id=40), 'confirmed', 'hello again');
ROLLBACK TO t3;

\echo '--- Test 3c: with ON CONFLICT DO NOTHING. Expect: INSERT 0 0'
INSERT INTO notifications (user_id, booking_id, type, message)
VALUES ((SELECT id FROM users WHERE email='proof3@example.com'),
        (SELECT id FROM bookings WHERE seat_id=40), 'confirmed', 'hello again')
ON CONFLICT (booking_id, type) DO NOTHING;

\echo '--- Test 4a: first outbox row. Expect: INSERT 0 1'
INSERT INTO outbox (booking_id, type)
VALUES ((SELECT id FROM bookings WHERE seat_id=40), 'notify_confirmed');

\echo '--- Test 4b: same (booking, type). Expect: ERROR 23505'
SAVEPOINT t4;
INSERT INTO outbox (booking_id, type)
VALUES ((SELECT id FROM bookings WHERE seat_id=40), 'notify_confirmed');
ROLLBACK TO t4;

\echo '--- Test 5a: row is unsent. Expect: 1 row'
SELECT id, sent_at FROM outbox WHERE sent_at IS NULL;

\echo '--- Test 5b: set sent_at, then check again. Expect: 0 rows'
UPDATE outbox SET sent_at = now();
SELECT id FROM outbox WHERE sent_at IS NULL;

\set VERBOSITY default
ROLLBACK;
