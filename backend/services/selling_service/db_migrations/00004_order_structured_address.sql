-- +goose Up
-- +goose StatementBegin
-- Replace the order's free-text customer address with a STRUCTURED SNAPSHOT (#118).
--
-- Codes AND names are frozen here on purpose. region_service's rows change — a desa is renamed,
-- merged, split — and a historical order must keep reading exactly what was agreed. Storing the
-- names means rendering a past order never needs region_service at all, and there is no cross-service
-- FK (HARD RULE 3): these are opaque codes this service owns a copy of.
--
-- Flat columns rather than one JSONB blob: an address is a fixed 4-tier shape, and "which orders ship
-- to this kecamatan" is a question worth being able to ask (shipping rate calc, #73/#76).
ALTER TABLE orders
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

-- The old free text WAS the street detail, which is exactly what address_line now holds — so carry it
-- across rather than dropping it on the floor. The region levels stay empty for those orders: nobody
-- ever picked them, and guessing them from free text would be inventing history.
UPDATE orders SET address_line = customer_address WHERE customer_address <> '';

ALTER TABLE orders DROP COLUMN customer_address;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders ADD COLUMN customer_address TEXT NOT NULL DEFAULT '';

-- Going back, only the street detail survives — the region levels have nowhere to live in free text.
UPDATE orders SET customer_address = address_line WHERE address_line <> '';

ALTER TABLE orders
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
