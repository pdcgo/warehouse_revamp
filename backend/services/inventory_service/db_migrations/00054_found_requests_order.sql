-- +goose Up
-- +goose StatementBegin
-- A FOUND FROM A LOST ORDER NAMES THE ORDER (docs/business/order/context_decision.md —
-- a-found-lost-parcel-is-a-found-stock-in). A parcel of an order gone `lost` that turns up at the warehouse it shipped
-- from is reported as a found request naming the order; approving it mints the units back under the order's team at
-- the cost the order took them at — one batch per batch the order's take drew from (inventory_mutations
-- .PostOrderFoundApproval). The order stays lost (lost-is-final).
--
-- `order_id` is selling_service's order id: no FK (another service's). `order_take_transaction_id` is the order's take
-- — inventory's own transaction, read from selling at the report — whose batch rows price the mint, and whose row the
-- approval locks so two approvals of one order's founds never bring back more than it took. Both or neither.
-- Rows before this migration name no order: both NULL.
ALTER TABLE found_requests
    ADD COLUMN order_id                  BIGINT CHECK (order_id > 0),
    ADD COLUMN order_take_transaction_id BIGINT REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    ADD CONSTRAINT found_requests_order_names_its_take CHECK (
        (order_id IS NULL) = (order_take_transaction_id IS NULL));

-- The founds of one order's product — what the report and the approval bound by what its take drew.
CREATE INDEX found_requests_order_idx ON found_requests (order_id, product_id) WHERE order_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX found_requests_order_idx;
ALTER TABLE found_requests
    DROP CONSTRAINT found_requests_order_names_its_take,
    DROP COLUMN order_take_transaction_id,
    DROP COLUMN order_id;
-- +goose StatementEnd
