-- +goose Up
-- +goose StatementBegin
CREATE TABLE shippings (
    id         BIGSERIAL   PRIMARY KEY,
    code       TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT shippings_code_present CHECK (code <> ''),
    CONSTRAINT shippings_name_present CHECK (name <> '')
);

CREATE UNIQUE INDEX shippings_code_unique ON shippings (code);

-- Seed the couriers common in Indonesia. This is stable REFERENCE data — not environment-specific
-- and not credentials — so it belongs in the migration (it must exist in production too), unlike
-- the dev-user fixture, which lives in `cmd/tool seed` and refuses production.
INSERT INTO shippings (code, name) VALUES
    ('jne',       'JNE'),
    ('jnt',       'J&T Express'),
    ('sicepat',   'SiCepat'),
    ('anteraja',  'AnterAja'),
    ('ninja',     'Ninja Xpress'),
    ('pos',       'Pos Indonesia'),
    ('tiki',      'TIKI'),
    ('wahana',    'Wahana'),
    ('lion',      'Lion Parcel'),
    ('idexpress', 'ID Express'),
    ('sap',       'SAP Express'),
    ('ncs',       'NCS');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE shippings;
-- +goose StatementEnd
