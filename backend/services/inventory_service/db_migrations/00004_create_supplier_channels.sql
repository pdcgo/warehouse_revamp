-- +goose Up
-- +goose StatementBegin
CREATE TABLE supplier_channels (
    id           BIGSERIAL   PRIMARY KEY,

    -- The supplier this channel belongs to. A REAL FK (same service) — deleting a supplier drops its
    -- channels. Scope to a team is enforced by the handler (it verifies the supplier is in the team).
    supplier_id  BIGINT      NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,

    -- 'online' | 'offline' — mapped in the handler layer (no CHECK IN-list, cf. #80).
    type         TEXT        NOT NULL,

    -- Online only: the marketplace code (shopee/tiktok/...). Empty for an offline channel.
    marketplace  TEXT        NOT NULL DEFAULT '',

    -- The store / shop name. Always present.
    name         TEXT        NOT NULL,

    -- Online only: a link to the store. Offline: a contact and a physical location. All optional.
    url          TEXT        NOT NULL DEFAULT '',
    contact      TEXT        NOT NULL DEFAULT '',
    location     TEXT        NOT NULL DEFAULT '',

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT supplier_channels_name_present CHECK (name <> '')
);

CREATE INDEX supplier_channels_supplier_idx ON supplier_channels (supplier_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE supplier_channels;
-- +goose StatementEnd
