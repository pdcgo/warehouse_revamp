-- +goose Up
-- +goose StatementBegin

-- The derived on-hand snapshot: one row per (warehouse, product). Maintained from the ledger inside
-- each movement's transaction. The CHECK is the negative-stock guard — an over-draw fails the whole
-- movement rather than writing a negative on-hand.
CREATE TABLE stock_levels (
    warehouse_id BIGINT      NOT NULL,  -- opaque team_service id (a WAREHOUSE team); no FK
    product_id   BIGINT      NOT NULL,  -- opaque product_service id; no FK
    on_hand      BIGINT      NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (warehouse_id, product_id),
    CONSTRAINT stock_levels_on_hand_nonneg CHECK (on_hand >= 0)
);

-- The append-only ledger: the source of truth. Never UPDATE or DELETE a row.
CREATE TABLE stock_movements (
    id            BIGSERIAL   PRIMARY KEY,
    warehouse_id  BIGINT      NOT NULL,
    product_id    BIGINT      NOT NULL,
    delta         BIGINT      NOT NULL,  -- signed: + in, - out
    balance       BIGINT      NOT NULL,  -- on-hand after this movement
    kind          SMALLINT    NOT NULL,  -- MovementKind enum number
    reason        TEXT        NOT NULL DEFAULT '',
    ref           TEXT        NOT NULL DEFAULT '',
    actor_user_id BIGINT      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History reads walk a product's movements at a warehouse newest-first.
CREATE INDEX stock_movements_wh_product_idx ON stock_movements (warehouse_id, product_id, id DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE stock_movements;
DROP TABLE stock_levels;
-- +goose StatementEnd
