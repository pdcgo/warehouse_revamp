-- +goose Up
-- +goose StatementBegin
CREATE TABLE restock_requests (
    id                 BIGSERIAL   PRIMARY KEY,

    -- The SELLING team that raised the request, and the target WAREHOUSE that fulfils it. Opaque
    -- cross-service ids — NO FK; scope is enforced by the access interceptor (use_scope), not the DB.
    requesting_team_id BIGINT      NOT NULL,
    warehouse_id       BIGINT      NOT NULL,

    -- The product to restock (opaque product_service id) plus a sku/name snapshot at request time.
    product_id         BIGINT      NOT NULL,
    sku                TEXT        NOT NULL,
    name               TEXT        NOT NULL,

    quantity           BIGINT      NOT NULL,
    shipping_code      TEXT        NOT NULL DEFAULT '',

    -- 'pending' | 'fulfilled' | 'cancelled' — mapped in the handler layer (no CHECK IN-list, cf. #80).
    status             TEXT        NOT NULL DEFAULT 'pending',

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT restock_requests_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX restock_requests_requesting_team_idx ON restock_requests (requesting_team_id);
CREATE INDEX restock_requests_warehouse_idx ON restock_requests (warehouse_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE restock_requests;
-- +goose StatementEnd
