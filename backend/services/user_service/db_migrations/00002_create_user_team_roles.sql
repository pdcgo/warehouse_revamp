-- +goose Up
-- +goose StatementBegin
CREATE TABLE user_team_roles (
    id         BIGSERIAL   PRIMARY KEY,

    -- NO foreign key to `teams`: that table belongs to team_service, and a cross-service FK
    -- would couple the two databases. Team ids are opaque here; they are resolved over RPC
    -- (team_service.TeamByIds), never joined.
    team_id    BIGINT      NOT NULL,

    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- The raw warehouse.role_base.v1.Role enum NUMBER. Not a Postgres enum: proto enums are
    -- open, so a PG enum would need a migration for every new role.
    role       BIGINT      NOT NULL DEFAULT 0,
    alias      TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LOAD-BEARING, not hygiene.
-- The authorization read does `LIMIT 1` and caches a single scalar. Two roles for one user in
-- one team would make authorization depend on which row the planner happened to return.
-- It is also what makes the TeamUserUpdate upsert (ON CONFLICT) possible at all.
CREATE UNIQUE INDEX user_team_roles_team_user_unique ON user_team_roles (team_id, user_id);

CREATE INDEX user_team_roles_user_idx ON user_team_roles (user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE user_team_roles;
-- +goose StatementEnd
