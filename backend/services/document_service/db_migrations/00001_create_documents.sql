-- +goose Up
-- +goose StatementBegin
CREATE TABLE documents (
    id            TEXT        PRIMARY KEY,

    -- The owning team — opaque cross-service scope (no FK). Every RPC is team-scoped.
    team_id       BIGINT      NOT NULL,

    resource_type TEXT        NOT NULL,
    object_key    TEXT        NOT NULL,
    mime_type     TEXT        NOT NULL DEFAULT '',
    size_bytes    BIGINT      NOT NULL DEFAULT 0,
    filename      TEXT        NOT NULL DEFAULT '',
    created_by_id BIGINT      NOT NULL DEFAULT 0,

    -- pending until the bytes are confirmed uploaded, then active. No 'deleted' state: unconfirmed
    -- rows are cleaned by the storage lifecycle, not a flag.
    status        TEXT        NOT NULL DEFAULT 'pending',

    -- Stable URL, set on confirm for PUBLIC resource types only.
    public_url    TEXT        NOT NULL DEFAULT '',

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT documents_status_valid        CHECK (status IN ('pending', 'active')),
    CONSTRAINT documents_resource_type_valid CHECK (resource_type IN ('general', 'profile_picture'))
);

CREATE INDEX documents_team_idx ON documents (team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE documents;
-- +goose StatementEnd
