-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S NOTE IS A TIMELINE ROW (a-note-is-a-timeline-row, owner 2026-10-26): one row of order_timeline_logs with NO
-- status — the text, the side it came from, who wrote it and when — written by either end and never edited or deleted.
-- The owner's order/context.md §Table That Must Have gives the timeline `note`, `from` and `actor_id`, and `orders` no
-- note at all.
--
-- The free-text `orders.note` (00009) becomes each order's FIRST NOTE ROW, exactly as a note typed on the create form is
-- written from now on: from 'selling', by whoever placed the order (`created_by_user_id`, 00013 — 0 when not recorded,
-- which is what 0 means on the timeline too), at the order's own moment (`orders.created_at`).
--
-- TRIMMED as it moves, the way the handlers trim a note today, so a note of only spaces or blank lines — which the old
-- column stored verbatim — does not become a row that reads as nothing.
--
-- WHERE IT SORTS. Every timeline reader orders by (created_at, id) — OrderDetail's preload and
-- order_timeline_logs_order_idx. The moved row takes the order's created_at, so it sits at the moment the order came
-- into being, before every later move and every later note. Its id is NEW, so where the order already has its
-- placement row (`pending`, written at that same instant by every order placed since 00017) the note sorts straight
-- after it — which is exactly where placeOrder now writes a form's note (the same INSERT, the next id). An order placed
-- before 00017 has no placement row (order_events was dropped, not migrated), and the note is simply its earliest row.
-- No note row existed before this migration (nothing wrote a status-less row), so it is each order's first note.
--
-- NOT EXISTS keeps a Down → Up cycle from writing a note twice: the Down leaves the rows where they are (a note is never
-- deleted), so an order whose note is already one of its note rows is skipped.
INSERT INTO order_timeline_logs (order_id, status, note, "from", actor_id, created_at)
SELECT o.id,
       '',
       btrim(o.note, E' \t\r\n'),
       'selling',
       o.created_by_user_id,
       o.created_at
FROM orders o
WHERE btrim(o.note, E' \t\r\n') <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM order_timeline_logs tl
      WHERE tl.order_id = o.id
        AND tl.status = ''
        AND tl.note = btrim(o.note, E' \t\r\n')
  )
ORDER BY o.id;

ALTER TABLE orders
    DROP COLUMN note;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- The column comes back holding each order's EARLIEST note row — the moved note, or on an order that had none, the
-- first note written since. Nothing is deleted: the note rows stay on the timeline, because a note is never deleted,
-- and the Up's NOT EXISTS is what makes running it again safe.
ALTER TABLE orders
    ADD COLUMN note TEXT NOT NULL DEFAULT '';

UPDATE orders o
SET note = first_note.note
FROM (
    SELECT DISTINCT ON (order_id) order_id, note
    FROM order_timeline_logs
    WHERE status = ''
    ORDER BY order_id, created_at, id
) AS first_note
WHERE first_note.order_id = o.id;
-- +goose StatementEnd
