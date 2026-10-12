-- +goose Up
-- +goose StatementBegin

-- The courier catalogue — docs/business/shipment/context_decision.md.
--
-- One row per COURIER (a-channel-is-a-courier). A row is never removed: `is_deleted` hides it from
-- pickers while an old order's shipment_channel_id still resolves (a-channel-is-soft-deleted).
CREATE TABLE shipment_channels (
    id         BIGSERIAL   PRIMARY KEY,
    code       TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    "desc"     TEXT        NOT NULL DEFAULT '',
    is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT shipment_channels_code_shape CHECK (code ~ '^[a-z0-9_]+$'),
    CONSTRAINT shipment_channels_name_present CHECK (name <> '')
);

-- A PLAIN unique index, not a partial one: a deleted channel keeps its code, and re-creating it is
-- refused in favour of restore (a-deleted-code-is-restored-not-recreated).
CREATE UNIQUE INDEX shipment_channels_code_unique ON shipment_channels (code);

-- Reference data that must exist in production too (the-three-channels-are-seeded).
INSERT INTO shipment_channels (code, name) VALUES
    ('jne',     'JNE'),
    ('jnt',     'J&T'),
    ('sicepat', 'SiCepat');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE shipment_channels;
-- +goose StatementEnd
