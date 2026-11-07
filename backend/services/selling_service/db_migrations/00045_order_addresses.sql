-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S ADDRESS IS ITS OWN ROW, NAMES ONLY (an-address-is-plain-names, one-address-per-order-and-per-draft): the
-- owner's `order_addresses` — the buyer the parcel is for and where it goes, as text a courier reads. No region_service
-- codes are kept (the four `_code` columns on `orders` are dropped, not moved), and `kode_pos` is `postal_code`.
--
-- EXACTLY ONE PER ORDER: `order_id` UNIQUE, written in the order's own transaction (placeOrder), so the join is total and
-- a correction updates the one row. The customer's name is required HERE now — `orders_customer_present` moves with the
-- column, so the guarantee is not quietly lost.
CREATE TABLE order_addresses (
    id             BIGSERIAL PRIMARY KEY,
    order_id       BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    customer_name  TEXT        NOT NULL,
    customer_phone TEXT        NOT NULL DEFAULT '',
    provinsi_name  TEXT        NOT NULL DEFAULT '',
    kabupaten_name TEXT        NOT NULL DEFAULT '',
    kecamatan_name TEXT        NOT NULL DEFAULT '',
    desa_name      TEXT        NOT NULL DEFAULT '',
    postal_code    TEXT        NOT NULL DEFAULT '',
    address_line   TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_addresses_order_unique UNIQUE (order_id),
    CONSTRAINT order_addresses_customer_present CHECK (customer_name <> '')
);

-- A developer's existing orders keep their buyer: one row each, copied as the names they hold (the codes are dropped).
-- Revamp has no real orders (revamp-has-no-real-orders-yet) — this fill exists only so every order keeps its one row.
INSERT INTO order_addresses (order_id, customer_name, customer_phone, provinsi_name, kabupaten_name, kecamatan_name,
                             desa_name, postal_code, address_line, created_at, updated_at)
SELECT id, customer_name, customer_phone, provinsi_name, kabupaten_name, kecamatan_name,
       desa_name, kode_pos, address_line, created_at, updated_at
FROM orders;

ALTER TABLE orders
    DROP CONSTRAINT orders_customer_present,
    DROP COLUMN customer_name,
    DROP COLUMN customer_phone,
    DROP COLUMN provinsi_code,
    DROP COLUMN provinsi_name,
    DROP COLUMN kabupaten_code,
    DROP COLUMN kabupaten_name,
    DROP COLUMN kecamatan_code,
    DROP COLUMN kecamatan_name,
    DROP COLUMN desa_code,
    DROP COLUMN desa_name,
    DROP COLUMN kode_pos,
    DROP COLUMN address_line;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    ADD COLUMN customer_name  TEXT NOT NULL DEFAULT '',
    ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN provinsi_code  TEXT NOT NULL DEFAULT '',
    ADD COLUMN provinsi_name  TEXT NOT NULL DEFAULT '',
    ADD COLUMN kabupaten_code TEXT NOT NULL DEFAULT '',
    ADD COLUMN kabupaten_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN kecamatan_code TEXT NOT NULL DEFAULT '',
    ADD COLUMN kecamatan_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN desa_code      TEXT NOT NULL DEFAULT '',
    ADD COLUMN desa_name      TEXT NOT NULL DEFAULT '',
    ADD COLUMN kode_pos       TEXT NOT NULL DEFAULT '',
    ADD COLUMN address_line   TEXT NOT NULL DEFAULT '';

UPDATE orders o
SET customer_name  = a.customer_name,
    customer_phone = a.customer_phone,
    provinsi_name  = a.provinsi_name,
    kabupaten_name = a.kabupaten_name,
    kecamatan_name = a.kecamatan_name,
    desa_name      = a.desa_name,
    kode_pos       = a.postal_code,
    address_line   = a.address_line
FROM order_addresses a
WHERE a.order_id = o.id;

-- An order with no address row (none should exist) would fail the old CHECK; it is named rather than guessed.
UPDATE orders SET customer_name = '(no address row)' WHERE customer_name = '';

ALTER TABLE orders
    ADD CONSTRAINT orders_customer_present CHECK (customer_name <> '');

DROP TABLE order_addresses;
-- +goose StatementEnd
