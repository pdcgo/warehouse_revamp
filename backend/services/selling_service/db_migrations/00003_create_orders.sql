-- +goose Up
-- +goose StatementBegin
-- The selling side of an order (#67): who ordered, from which shop, the frozen money. Fulfillment
-- (pick/pack/ship) is not modelled here — it waits on the warehouse core.
CREATE TABLE orders (
    id               BIGSERIAL   PRIMARY KEY,
    team_id          BIGINT      NOT NULL,
    -- The shop the order came through (same service, so a real FK is fine).
    shop_id          BIGINT      NOT NULL REFERENCES shops (id),

    -- OrderStatus enum as text; no CHECK IN-list (mapper + proto guard it, cf. #80).
    status           TEXT        NOT NULL DEFAULT 'placed',

    customer_name    TEXT        NOT NULL,
    customer_phone   TEXT        NOT NULL DEFAULT '',
    customer_address TEXT        NOT NULL DEFAULT '',
    -- A shipping_service courier code (opaque; no FK).
    shipping_code    TEXT        NOT NULL DEFAULT '',

    -- Frozen money, whole rupiah.
    subtotal         BIGINT      NOT NULL DEFAULT 0,
    shipping_cost    BIGINT      NOT NULL DEFAULT 0,
    total            BIGINT      NOT NULL DEFAULT 0,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT orders_customer_present CHECK (customer_name <> '')
);

CREATE INDEX orders_team_idx ON orders (team_id);
CREATE INDEX orders_shop_idx ON orders (shop_id);

CREATE TABLE order_items (
    id         BIGSERIAL   PRIMARY KEY,
    order_id   BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    -- Opaque product_service id; sku/name/unit_price are a snapshot at order time.
    product_id BIGINT      NOT NULL,
    sku        TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    quantity   INT         NOT NULL,
    unit_price BIGINT      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT order_items_quantity_positive CHECK (quantity >= 1)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_items;
DROP TABLE orders;
-- +goose StatementEnd
