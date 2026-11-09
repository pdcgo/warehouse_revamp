-- +goose Up
-- THE WAREHOUSE PROFILE MOVED to warehouse_service (the-warehouse-profile-lives-in-warehouse-service), which creates its
-- own table in its own migration. team_service keeps only what describes a TEAM. Dev data only — re-entered there.
DROP TABLE warehouse_infos;

-- +goose Down
CREATE TABLE warehouse_infos (
    id              BIGSERIAL   PRIMARY KEY,
    team_id         BIGINT      NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    operating_hours JSONB       NOT NULL DEFAULT '[]',
    receiving_hours JSONB       NOT NULL DEFAULT '[]',
    location        TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX warehouse_infos_team_id_unique ON warehouse_infos (team_id);
