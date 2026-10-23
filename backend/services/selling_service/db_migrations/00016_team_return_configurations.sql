-- +goose Up
-- WHERE A SELLING TEAM'S RETURNS ARE RECEIVED (the-return-warehouse-lives-in-team-return-configurations).
--
-- One row per team, in the order context, because the order context is what reads it: the order create check
-- (create-refuses-a-team-with-no-return-warehouse) asks this table and calls no other service. It replaces
-- team_infos.return_warehouse_id, which nothing read and team_service drops in its 00009.
--
-- warehouse_id is opaque — a warehouse is a team_service team, and no FK crosses a service boundary. ANY
-- warehouse may be named (a-team-may-pick-any-return-warehouse), so nothing here checks the pair.
--
-- No row = not set. The table starts empty: the rollout is the table and its screen, then a row for every team,
-- and only then the create check — never in one commit.
CREATE TABLE team_return_configurations (
    id           BIGSERIAL PRIMARY KEY,
    team_id      BIGINT      NOT NULL,
    warehouse_id BIGINT      NOT NULL CHECK (warehouse_id > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One per team — and what lets Set be one INSERT … ON CONFLICT, so two managers saving at once leave one row.
CREATE UNIQUE INDEX team_return_configurations_team_idx ON team_return_configurations (team_id);

-- +goose Down
DROP TABLE team_return_configurations;
