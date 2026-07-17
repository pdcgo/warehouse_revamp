-- +goose Up
-- +goose StatementBegin
-- The racks inside a warehouse (#129) — the registry only: a warehouse writes down the places it has.
--
-- Stock is still counted per (warehouse, product) in stock_levels. Putting stock ON a rack is the
-- location-level model in plans/inventory_service/ §3, which is a separate owner decision — having a
-- list of racks does not imply it, and nothing here references a rack yet.
CREATE TABLE racks (
    id           BIGSERIAL   PRIMARY KEY,

    -- The warehouse team this rack stands in. Opaque cross-service id — NO FK to team_service.teams;
    -- scope is enforced by the access interceptor (use_scope), not the DB.
    warehouse_id BIGINT      NOT NULL,

    -- What is painted on the shelf, e.g. 'A-01-3'.
    code         TEXT        NOT NULL,
    name         TEXT        NOT NULL DEFAULT '',
    description  TEXT        NOT NULL DEFAULT '',

    deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT racks_code_present CHECK (code <> '')
);

-- The label is unique per warehouse, but only among ACTIVE racks: a soft-deleted rack frees its code
-- for reuse (a shelf gets re-labelled), and two warehouses may both have an 'A-01-3'.
CREATE UNIQUE INDEX racks_warehouse_code_active_unique ON racks (warehouse_id, code) WHERE deleted = FALSE;
CREATE INDEX racks_warehouse_active_idx ON racks (warehouse_id) WHERE deleted = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE racks;
-- +goose StatementEnd
