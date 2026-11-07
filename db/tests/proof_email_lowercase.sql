-- Proof test: email must be lowercase (users CHECK)
BEGIN;
\set VERBOSITY verbose

\echo '--- Test 1: mixed-case email. Expect: ERROR 23514 (check)'
SAVEPOINT t1;
INSERT INTO users (email, password_hash) VALUES ('John.Doe@Example.com', 'x');
ROLLBACK TO t1;

\echo '--- Test 2: lowercase email. Expect: INSERT 0 1'
INSERT INTO users (email, password_hash) VALUES ('john.doe@example.com', 'x');

\echo '--- Test 3: same email again. Expect: ERROR 23505'
SAVEPOINT t3;
INSERT INTO users (email, password_hash) VALUES ('john.doe@example.com', 'x');
ROLLBACK TO t3;

\set VERBOSITY default
ROLLBACK;
