-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S RETURN BACK ON THE SHELF (docs/business/inventory/return_decision.md). The return itself is an
-- inventory_transactions row of type `return` (already in every CHECK list), its batches and rack rows the ledgers' own.
-- Two tables are new:

-- 1. ONCE PER TAKE. An order's take returned once: the take is the key, the row names the `return` transaction it
--    bought, claimed in that transaction. A retried or raced accept meets the key and is answered with the first one's
--    return, never a second stock-in.
CREATE TABLE order_return_checks (
    take_transaction_id BIGINT      PRIMARY KEY REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    transaction_id      BIGINT      NOT NULL UNIQUE REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT order_return_checks_not_itself CHECK (transaction_id <> take_transaction_id)
);

-- 2. THE RETURN'S DOOR TABLE (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door):
--    one product's broken or missing units of a returned parcel, one row per kind, priced from the layers they came off,
--    newest first, at what the selling team paid. The selling team's — never the warehouse's payable, never claimable,
--    not in Inventory Lost. Shaped like warehouse_transfer_problem_items, keyed by the return transaction.
CREATE TABLE order_return_problem_items (
    id             BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    -- The product the take drew — the order line's, as the parcel's label names it.
    product_id     BIGINT           NOT NULL CHECK (product_id > 0),
    problem_type   TEXT             NOT NULL CHECK (problem_type IN ('broken', 'missing')),
    -- The crew's optional note (a-return-door-row-carries-an-optional-note).
    note           TEXT             NOT NULL DEFAULT '',
    count          BIGINT           NOT NULL CHECK (count > 0),
    price_unit     DOUBLE PRECISION NOT NULL DEFAULT 0,
    total          DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT order_return_problem_items_one_per_kind UNIQUE (transaction_id, product_id, problem_type)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_return_problem_items;
DROP TABLE order_return_checks;
-- +goose StatementEnd
