-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S KEY IS CLAIMED ONCE, IN ONE PLACE (the-key-is-claimed-in-its-own-table): the take claims it with its
-- transaction, a release that arrives first claims it with none. Whichever claims first wins; the other meets the
-- unique index. Nothing else reads it — it is a tool between the order service and inventory, for one job.
CREATE TABLE idempotency_order_check (
    id              BIGSERIAL PRIMARY KEY,
    -- K, minted by the order form for each submit (every-submit-mints-a-new-key). Unique on the key alone.
    idempotency_key TEXT        NOT NULL CHECK (idempotency_key <> ''),
    -- The take it bought. NULL = released before anything was taken, so a take arriving late is refused.
    transaction_id  BIGINT      REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT idempotency_order_check_key_unique UNIQUE (idempotency_key)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE idempotency_order_check;
-- +goose StatementEnd
