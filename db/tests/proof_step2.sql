-- Proof test Step 2: payments and refunds
BEGIN;
\set VERBOSITY verbose

INSERT INTO users (email, password_hash) VALUES ('proof2@example.com', 'x');
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof2@example.com'), 1, 10, 'confirmed');

\echo '--- Test 1a: first payment. Expect: INSERT 0 1'
INSERT INTO payments (payment_key, user_id, event_id, seat_id, amount_rupees, status)
VALUES ('pay_same', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 20, 500, 'failed');

\echo '--- Test 1b: same payment_key again. Expect: ERROR 23505'
SAVEPOINT t1;
INSERT INTO payments (payment_key, user_id, event_id, seat_id, amount_rupees, status)
VALUES ('pay_same', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 21, 500, 'failed');
ROLLBACK TO t1;

\echo '--- Test 2a: first started payment (seat 30). Expect: INSERT 0 1'
INSERT INTO payments (payment_key, user_id, event_id, seat_id, amount_rupees, status)
VALUES ('pay_a', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 30, 500, 'started');

\echo '--- Test 2b: second started payment, same user and seat. Expect: ERROR 23505'
SAVEPOINT t2;
INSERT INTO payments (payment_key, user_id, event_id, seat_id, amount_rupees, status)
VALUES ('pay_b', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 30, 500, 'started');
ROLLBACK TO t2;

\echo '--- Test 3a: first payment becomes failed. Expect: UPDATE 1'
UPDATE payments SET status='failed' WHERE payment_key='pay_a';

\echo '--- Test 3b: new started payment, same user and seat. Expect: INSERT 0 1'
INSERT INTO payments (payment_key, user_id, event_id, seat_id, amount_rupees, status)
VALUES ('pay_c', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 30, 500, 'started');

\echo '--- Test 4: booking_id set with status started. Expect: ERROR 23514 (check)'
SAVEPOINT t4;
INSERT INTO payments (payment_key, user_id, event_id, seat_id, booking_id, amount_rupees, status)
VALUES ('pay_d', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 10,
        (SELECT id FROM bookings WHERE seat_id=10), 500, 'started');
ROLLBACK TO t4;

-- Setup for refund tests: a succeeded payment linked to the booking
INSERT INTO payments (payment_key, user_id, event_id, seat_id, booking_id, amount_rupees, status)
VALUES ('pay_e', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 10,
        (SELECT id FROM bookings WHERE seat_id=10), 500, 'succeeded');

\echo '--- Test 5a: first refund. Expect: INSERT 0 1'
INSERT INTO refunds (booking_id, payment_id, refund_key, amount_rupees, status)
VALUES ((SELECT id FROM bookings WHERE seat_id=10),
        (SELECT id FROM payments WHERE payment_key='pay_e'), 'ref_1', 500, 'pending');

\echo '--- Test 5b: second refund, same booking. Expect: ERROR 23505'
SAVEPOINT t5;
INSERT INTO refunds (booking_id, payment_id, refund_key, amount_rupees, status)
VALUES ((SELECT id FROM bookings WHERE seat_id=10),
        (SELECT id FROM payments WHERE payment_key='pay_e'), 'ref_2', 500, 'pending');
ROLLBACK TO t5;

\echo '--- Test 6: same refund_key on a different booking. Expect: ERROR 23505'
INSERT INTO bookings (user_id, event_id, seat_id, status)
VALUES ((SELECT id FROM users WHERE email='proof2@example.com'), 1, 11, 'confirmed');
INSERT INTO payments (payment_key, user_id, event_id, seat_id, booking_id, amount_rupees, status)
VALUES ('pay_f', (SELECT id FROM users WHERE email='proof2@example.com'), 1, 11,
        (SELECT id FROM bookings WHERE seat_id=11), 500, 'succeeded');
SAVEPOINT t6;
INSERT INTO refunds (booking_id, payment_id, refund_key, amount_rupees, status)
VALUES ((SELECT id FROM bookings WHERE seat_id=11),
        (SELECT id FROM payments WHERE payment_key='pay_f'), 'ref_1', 500, 'pending');
ROLLBACK TO t6;

\set VERBOSITY default
ROLLBACK;
