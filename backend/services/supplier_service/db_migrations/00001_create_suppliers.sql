-- +goose Up
-- +goose StatementBegin

-- The vendors a selling team buys stock from — docs/business/supplier/context_decision.md.
--
-- Moved out of inventory_service (the-supplier-gets-its-own-service). The rows that exist there are
-- copied in by `san supplier move`, KEEPING THEIR IDS (existing-suppliers-move-with-their-ids): restocks
-- and batches hold those ids, so a supplier must keep the number it was born with.
--
-- ⚠ DELETE IS SOFT, here and on the stores (a-deleted-supplier-is-kept-for-its-figures,
-- a-store-delete-is-soft-too): a past restock and the daily figures still read a deleted supplier's name.
-- A row is never removed, which is why the store's foreign key has no ON DELETE.
CREATE TABLE suppliers (
    id          BIGSERIAL   PRIMARY KEY,
    -- The team that keeps it — always a selling team (only-a-selling-team-has-suppliers). Opaque: a
    -- team_service id, no FK across services.
    team_id     BIGINT      NOT NULL,
    name        TEXT        NOT NULL,
    contact     TEXT        NOT NULL DEFAULT '',
    address     TEXT        NOT NULL DEFAULT '',
    description TEXT        NOT NULL DEFAULT '',
    -- NULL = live. Set by SupplierDelete; nothing clears it.
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT suppliers_name_present CHECK (name <> '')
);

-- My Supplier: a team's live suppliers, newest first.
CREATE INDEX suppliers_team_live_idx ON suppliers (team_id, id DESC) WHERE deleted_at IS NULL;

-- The online stores a supplier sells through, one row per store (the-supplier-lists-only-its-online-stores).
CREATE TABLE supplier_channels (
    id           BIGSERIAL   PRIMARY KEY,
    supplier_id  BIGINT      NOT NULL REFERENCES suppliers (id),
    -- The shared marketplace code (san_marketplace) — `other` is the owner's `custom`
    -- (channel-type-is-the-marketplace-list). Mapped in the handler, not by a CHECK IN-list, so a new
    -- marketplace needs no migration here.
    channel_type TEXT        NOT NULL,
    name         TEXT        NOT NULL,
    uri          TEXT        NOT NULL DEFAULT '',
    description  TEXT        NOT NULL DEFAULT '',
    -- NULL = live.
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT supplier_channels_name_present CHECK (name <> ''),
    CONSTRAINT supplier_channels_type_present CHECK (channel_type <> '')
);

-- A supplier's live stores — the Channels tab, and Discover's badges and store-name search.
CREATE INDEX supplier_channels_supplier_live_idx ON supplier_channels (supplier_id, id DESC) WHERE deleted_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE supplier_channels;
DROP TABLE suppliers;
-- +goose StatementEnd
