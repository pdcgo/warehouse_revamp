-- +goose Up
-- +goose StatementBegin
CREATE TABLE teams (
    id          BIGSERIAL   PRIMARY KEY,
    type        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    team_code   TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT teams_type_valid   CHECK (type IN ('root', 'admin', 'warehouse', 'selling')),
    CONSTRAINT teams_name_present CHECK (name <> ''),

    -- team_code is caller-supplied; there is no generator. Forbid empty rather than defaulting
    -- to '' under a UNIQUE index, which would let exactly ONE row have an empty code and then
    -- fail the next one with a duplicate-key error.
    CONSTRAINT teams_code_present CHECK (team_code <> ''),

    -- ROOT-NESS IS STRUCTURAL.
    -- The access interceptor hardcodes team 1 as the super-admin scope, so "id = 1" and
    -- "type = 'root'" must be the same statement. This makes the constant in the code and the
    -- data in the table unable to drift apart.
    CONSTRAINT teams_root_is_id_1 CHECK ((type = 'root') = (id = 1))
);

CREATE UNIQUE INDEX teams_team_code_unique ON teams (team_code);
CREATE INDEX teams_type_active_idx ON teams (type) WHERE deleted = FALSE;

CREATE TABLE team_infos (
    id      BIGSERIAL PRIMARY KEY,
    team_id BIGINT    NOT NULL REFERENCES teams (id) ON DELETE CASCADE,

    -- Opaque cross-service ids: warehouse_service and user_service own these. No FK is possible
    -- across a service boundary, and team_service does not validate them. NULL = unset.
    return_warehouse_id BIGINT,
    return_user_id      BIGINT,

    contact_number      TEXT NOT NULL DEFAULT '',
    bank_type           TEXT NOT NULL DEFAULT '',
    bank_owner_name     TEXT NOT NULL DEFAULT '',
    bank_account_number TEXT NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE, not a plain index. This is what makes TeamInfoUpdate a real ON CONFLICT upsert and
-- closes the duplicate-row race: without it, two concurrent updates on a team with no info row
-- both miss, both insert, and the team ends up with two info rows.
CREATE UNIQUE INDEX team_infos_team_id_unique ON team_infos (team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE team_infos;
DROP TABLE teams;
-- +goose StatementEnd
