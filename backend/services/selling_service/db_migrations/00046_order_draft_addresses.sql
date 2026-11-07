-- +goose Up
-- +goose StatementBegin
-- A DRAFT'S ADDRESS IS ITS OWN ROW, NAMES ONLY (a-draft-carries-the-scraped-address, an-address-is-plain-names,
-- one-address-per-order-and-per-draft): the owner's `order_draft_addresses`, mirroring `order_addresses` field for field
-- — the buyer and where the parcel goes, as the app scraped it or a person corrected it. No region_service codes: the
-- four `_code` columns on `order_drafts` are dropped, not moved, and `kode_pos` is `postal_code`.
--
-- EXACTLY ONE PER DRAFT: `order_draft_id` UNIQUE, written in the draft's own transaction (OrderDraftPush creates it with
-- the draft; a re-push and OrderDraftUpdate update the one row). BEST EFFORT: every field may be empty — a draft is
-- defined by being incomplete — so unlike `order_addresses` there is no customer CHECK here; OrderCreate is where the
-- name becomes required.
CREATE TABLE order_draft_addresses (
    id             BIGSERIAL   PRIMARY KEY,
    order_draft_id BIGINT      NOT NULL REFERENCES order_drafts (id) ON DELETE CASCADE,
    customer_name  TEXT        NOT NULL DEFAULT '',
    customer_phone TEXT        NOT NULL DEFAULT '',
    provinsi_name  TEXT        NOT NULL DEFAULT '',
    kabupaten_name TEXT        NOT NULL DEFAULT '',
    kecamatan_name TEXT        NOT NULL DEFAULT '',
    desa_name      TEXT        NOT NULL DEFAULT '',
    postal_code    TEXT        NOT NULL DEFAULT '',
    address_line   TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_draft_addresses_draft_unique UNIQUE (order_draft_id)
);

-- A developer's existing drafts keep their buyer: one row each, copied as the names they hold (the codes are dropped).
-- Revamp has no real drafts (revamp-has-no-real-orders-yet) — this fill exists only so every draft keeps its one row.
INSERT INTO order_draft_addresses (order_draft_id, customer_name, customer_phone, provinsi_name, kabupaten_name,
                                   kecamatan_name, desa_name, postal_code, address_line, created_at, updated_at)
SELECT id, customer_name, customer_phone, provinsi_name, kabupaten_name, kecamatan_name,
       desa_name, kode_pos, address_line, created_at, updated_at
FROM order_drafts;

ALTER TABLE order_drafts
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
ALTER TABLE order_drafts
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

UPDATE order_drafts d
SET customer_name  = a.customer_name,
    customer_phone = a.customer_phone,
    provinsi_name  = a.provinsi_name,
    kabupaten_name = a.kabupaten_name,
    kecamatan_name = a.kecamatan_name,
    desa_name      = a.desa_name,
    kode_pos       = a.postal_code,
    address_line   = a.address_line
FROM order_draft_addresses a
WHERE a.order_draft_id = d.id;

DROP TABLE order_draft_addresses;
-- +goose StatementEnd
