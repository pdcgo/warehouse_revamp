-- +goose Up
-- THE ORDER KEEPS ITS RETURN'S INVENTORY TRANSACTION (return_decision.md) — the `return` transaction its accepted return
-- was put back on the shelf in (inventory's OrderTransactionReturn), stored by OrderReturnAccept in the move to
-- return_completed, beside `transaction_id` (the take's).
--
-- NULL = not accepted back. No backfill (revamp-has-no-real-orders-yet): a developer's order accepted before the stock
-- half simply names none. Nothing reads orders BY it, so it has no index.
ALTER TABLE orders ADD COLUMN return_transaction_id BIGINT NULL;

-- +goose Down
ALTER TABLE orders DROP COLUMN return_transaction_id;
