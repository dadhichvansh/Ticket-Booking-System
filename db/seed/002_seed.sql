-- 002_seed.sql
-- Source: docs/02-requirements.md, assumption A-4
-- Events and seats are seeded (admin and event creation are out of scope).
-- Users are NOT seeded. They are created through signup.

INSERT INTO events (name, starts_at, price_rupees) VALUES
  ('Rock Night',     '2026-12-05 18:30:00+00',  500),
  ('Comedy Evening', '2026-12-12 19:00:00+00',  800),
  ('Classical Gala', '2026-12-20 17:00:00+00', 1200);

-- Rows are letters (A, B, C, ...). chr(65) = 'A', so chr(64 + 1) = 'A'.
-- ORDER BY makes seat ids predictable: sorted by event, then row, then number.
INSERT INTO seats (event_id, row_label, seat_number)
SELECT e.id, chr(64 + gr.row_no), gs.seat_no
FROM events e
JOIN (VALUES
  ('Rock Night',      10, 20),
  ('Comedy Evening',  20, 25),
  ('Classical Gala',  25, 40)
) AS cfg(event_name, row_count, seats_per_row) ON cfg.event_name = e.name
CROSS JOIN LATERAL generate_series(1, cfg.row_count)     AS gr(row_no)
CROSS JOIN LATERAL generate_series(1, cfg.seats_per_row) AS gs(seat_no)
ORDER BY e.id, gr.row_no, gs.seat_no;
