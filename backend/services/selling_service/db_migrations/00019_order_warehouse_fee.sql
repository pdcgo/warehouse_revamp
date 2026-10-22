-- +goose Up
-- +goose StatementBegin
-- THE WAREHOUSE'S FEE, FROZEN ON THE ORDER — the owner's `orders.warehouse_fee` (order context.md), step 3 of
-- the-flat-rate-is-dropped-last.
--
-- Priced once, at create, by warehouse_service's WarehouseFeeCalculate on the order's goods cost
-- (the-fee-is-priced-on-goods-cost), and never recomputed: a rate the warehouse changes next month must not rewrite
-- what this order cost. The order is where the number lives; balance is told it (the-event-carries-the-warehouse-fee).
--
-- DOUBLE PRECISION, unrounded, like the rate it came from (rupiah-is-floating-point). When a frozen figure is rounded
-- is not decided, so it is not rounded here.
--
-- NULL = NEVER PRICED: every order placed before this column. Deliberately not back-filled — the flat fee those orders
-- were charged is a liability row the order cannot read (balance Q9), and a guess written here would read as frozen.
-- 0 is a different fact: a warehouse that chose to charge nothing.
ALTER TABLE orders
    ADD COLUMN warehouse_fee DOUBLE PRECISION CHECK (warehouse_fee >= 0);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN warehouse_fee;
-- +goose StatementEnd
