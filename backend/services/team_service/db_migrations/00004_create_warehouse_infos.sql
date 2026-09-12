-- +goose Up
-- +goose StatementBegin
-- Warehouse-only operational data, 1:1 with a warehouse team. Kept in its OWN table (not
-- team_infos) so warehouse-specific fields never bloat every team's row.
--
-- The two weekly schedules are JSONB: a schedule is a small, always-read-whole document (7
-- weekday rows of open/close), not something joined or filtered on. Storing it as structured
-- columns would mean 7×2 rows or dozens of columns; JSONB keeps it one row and one table, which
-- is exactly the shape asked for. The handler validates the contents (one row per weekday,
-- valid HH:MM, open before close) — the DB stores it verbatim.
CREATE TABLE warehouse_infos (
    id      BIGSERIAL PRIMARY KEY,
    team_id BIGINT    NOT NULL REFERENCES teams (id) ON DELETE CASCADE,

    -- Each is a JSON array of {weekday:1..7, open:bool, open_time:"HH:MM", close_time:"HH:MM"}.
    operating_hours JSONB NOT NULL DEFAULT '[]',
    receiving_hours JSONB NOT NULL DEFAULT '[]',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1:1 with a team, and what makes the WarehouseInfoUpdate upsert (ON CONFLICT) possible.
CREATE UNIQUE INDEX warehouse_infos_team_id_unique ON warehouse_infos (team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE warehouse_infos;
-- +goose StatementEnd
