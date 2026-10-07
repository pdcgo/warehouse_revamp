-- +goose Up
-- +goose StatementBegin
CREATE TABLE suppliers (
    id          BIGSERIAL   PRIMARY KEY,

    -- The owning team. Opaque cross-service id — NO FK to team_service.teams; scope is enforced by
    -- the access interceptor (use_scope), not the DB.
    team_id     BIGINT      NOT NULL,

    code        TEXT        NOT NULL,
    name        TEXT        NOT NULL,

    contact     TEXT        NOT NULL DEFAULT '',
    province    TEXT        NOT NULL DEFAULT '',
    city        TEXT        NOT NULL DEFAULT '',
    address     TEXT        NOT NULL DEFAULT '',
    description TEXT        NOT NULL DEFAULT '',
    deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT suppliers_code_present CHECK (code <> ''),
    CONSTRAINT suppliers_name_present CHECK (name <> '')
);

-- code is unique per team, but only among ACTIVE suppliers: a soft-deleted supplier frees its code
-- for reuse, and two teams may use the same code.
CREATE UNIQUE INDEX suppliers_team_code_active_unique ON suppliers (team_id, code) WHERE deleted = FALSE;
CREATE INDEX suppliers_team_active_idx ON suppliers (team_id) WHERE deleted = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE suppliers;
-- +goose StatementEnd
