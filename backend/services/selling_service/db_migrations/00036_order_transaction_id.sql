-- +goose Up
-- THE ORDER KEEPS THE INVENTORY TRANSACTION ITS STOCK WAS TAKEN IN (backlog #10, slice 3) — the take's answer, stored
-- with the order in the transaction that inserts it. The placement page reads the order's racks from inventory by it
-- (the-placement-page-reads-racks-by-transaction-id).
--
-- NULL = none recorded. No backfill (revamp-has-no-real-orders-yet): a developer's order from before this column simply
-- shows no racks. Nothing reads orders BY it, so it has no index.
ALTER TABLE orders ADD COLUMN transaction_id BIGINT NULL;

-- +goose Down
ALTER TABLE orders DROP COLUMN transaction_id;
