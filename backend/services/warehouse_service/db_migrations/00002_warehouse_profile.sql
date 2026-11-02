-- +goose Up
-- THE WAREHOUSE PROFILE LIVES HERE (the-warehouse-profile-lives-in-warehouse-service): the location and both weekly
-- grids, moved whole out of team_service — which drops its own table in its own migration (HARD RULE 3). Existing rows
-- are dev data only: re-entered, never copied across services.
--
-- The two weekly schedules are JSONB: a small, always-read-whole document (seven weekday rows of open/close), not
-- something joined or filtered on. The handler validates the contents; the database stores them verbatim.
CREATE TABLE warehouse_infos (
    id           BIGSERIAL   PRIMARY KEY,
    -- The warehouse team, opaque team_service id — no FK across services.
    warehouse_id BIGINT      NOT NULL,

    -- Each is a JSON array of {weekday:1..7, open:bool, open_time:"HH:MM", close_time:"HH:MM"}.
    operating_hours JSONB NOT NULL DEFAULT '[]',
    receiving_hours JSONB NOT NULL DEFAULT '[]',
    location        TEXT  NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT warehouse_infos_one_per_warehouse UNIQUE (warehouse_id)
);

-- ONE-OFF CLOSURES (a-warehouse-records-its-holidays): whole days, both inclusive, Asia/Jakarta, with a reason the
-- closed-day warning names. They refuse nothing.
CREATE TABLE warehouse_closures (
    id           BIGSERIAL   PRIMARY KEY,
    warehouse_id BIGINT      NOT NULL,
    first_day    DATE        NOT NULL,
    last_day     DATE        NOT NULL,
    reason       TEXT        NOT NULL CHECK (reason <> ''),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT warehouse_closures_in_order CHECK (first_day <= last_day)
);

-- A warehouse's closures still to come — the profile and the warning both read them so.
CREATE INDEX warehouse_closures_warehouse_last_day_idx ON warehouse_closures (warehouse_id, last_day);

-- +goose Down
DROP TABLE warehouse_closures;
DROP TABLE warehouse_infos;
