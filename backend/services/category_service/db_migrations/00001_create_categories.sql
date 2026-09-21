-- +goose Up
-- +goose StatementBegin
CREATE TABLE categories (
    id         BIGSERIAL   PRIMARY KEY,
    name       TEXT        NOT NULL,

    -- Self-referential parent. NULL = top-level. The FK is to this same table (the taxonomy is one
    -- global tree), so a category can only point at a category that exists.
    parent_id  BIGINT      REFERENCES categories(id),

    deleted    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT categories_name_present CHECK (name <> '')
);

-- Lookups walk the tree by parent; only active rows matter.
CREATE INDEX categories_parent_idx ON categories (parent_id) WHERE deleted = FALSE;

-- Name is unique among ACTIVE siblings. COALESCE(parent_id, 0) folds the NULL top-level parent into
-- a single bucket, so two top-level categories can't share a name either. A soft delete frees the
-- name for reuse.
CREATE UNIQUE INDEX categories_parent_name_active_unique
    ON categories (COALESCE(parent_id, 0), name) WHERE deleted = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE categories;
-- +goose StatementEnd
