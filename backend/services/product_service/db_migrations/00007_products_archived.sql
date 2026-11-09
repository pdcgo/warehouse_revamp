-- +goose Up
-- `deleted` IS `archived` (a-used-product-is-archived-never-deleted). The soft delete was always an archive — the row
-- survives, its stock outlives it, Restore brings it back — and now that a real Delete exists beside it, a column named
-- "deleted" on a row that is merely archived would mislead every reader. The partial indexes follow the rename.
ALTER TABLE products RENAME COLUMN deleted TO archived;

-- +goose Down
ALTER TABLE products RENAME COLUMN archived TO deleted;
