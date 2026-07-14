-- +goose Up
-- +goose StatementBegin
CREATE TABLE products (
    id          BIGSERIAL   PRIMARY KEY,

    -- The owning team (a selling/warehouse team). Opaque cross-service id — NO FK to
    -- team_service.teams; scope is enforced by the access interceptor (use_scope), not the DB.
    team_id     BIGINT      NOT NULL,

    sku         TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT products_sku_present  CHECK (sku <> ''),
    CONSTRAINT products_name_present CHECK (name <> '')
);

-- SKU is unique per team, but only among ACTIVE products: a soft-deleted product frees its SKU for
-- reuse, and two teams may use the same SKU.
CREATE UNIQUE INDEX products_team_sku_active_unique ON products (team_id, sku) WHERE deleted = FALSE;
CREATE INDEX products_team_active_idx ON products (team_id) WHERE deleted = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE products;
-- +goose StatementEnd
