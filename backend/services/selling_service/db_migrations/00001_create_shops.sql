-- +goose Up
-- +goose StatementBegin
CREATE TABLE shops (
    id          BIGSERIAL   PRIMARY KEY,

    -- The owning SELLING team. Opaque cross-service id — NO FK to team_service.teams; scope is
    -- enforced by the access interceptor (use_scope), not the DB.
    team_id     BIGINT      NOT NULL,

    name        TEXT        NOT NULL,
    shop_code   TEXT        NOT NULL,

    -- The Marketplace enum as text ("shopee", …). Deliberately NO CHECK IN-list: the handler's
    -- mapper + proto validation guard the value, and an IN-list is one more place to drift when the
    -- enum grows (the trap that produced #80 on documents.resource_type).
    marketplace TEXT        NOT NULL DEFAULT '',

    description TEXT        NOT NULL DEFAULT '',
    deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT shops_name_present CHECK (name <> ''),
    CONSTRAINT shops_code_present CHECK (shop_code <> '')
);

-- shop_code is unique per team, but only among ACTIVE shops: a soft-deleted shop frees its code for
-- reuse, and two teams may use the same code.
CREATE UNIQUE INDEX shops_team_code_active_unique ON shops (team_id, shop_code) WHERE deleted = FALSE;
CREATE INDEX shops_team_active_idx ON shops (team_id) WHERE deleted = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE shops;
-- +goose StatementEnd
