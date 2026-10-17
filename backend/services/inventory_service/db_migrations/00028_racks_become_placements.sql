-- +goose Up
-- +goose StatementBegin
-- THE RACKS TABLE TAKES ITS DECIDED NAME AND RULES (ledgers stage 3): `placements` — the screen still says Racks
-- (the-racks-page-is-the-placement-list). The foreign keys that point at it follow the rename on their own.
--
--   · soft delete is a time, not a flag (a-placement-deletes-at-zero-stock): `deleted_at`, NULL = in use;
--   · a code is saved trimmed and lowercase (rack-codes-are-saved-lowercase), with a CHECK as the backstop and a plain
--     unique index among the racks in use.
--
-- Nothing runs in production, so codes are lowercased in place (no-switch-over-the-ledgers-replace-todays-tables). Two
-- codes that differ only by case in one warehouse (A-01 beside a-01) would collide: the later one keeps its id as a
-- suffix (a-01-42) — development data only, reseeded by `san dev setup`.
ALTER TABLE racks RENAME TO placements;
ALTER SEQUENCE racks_id_seq RENAME TO placements_id_seq;
ALTER INDEX racks_pkey RENAME TO placements_pkey;
ALTER TABLE placements RENAME CONSTRAINT racks_code_present TO placements_code_present;

ALTER TABLE placements ADD COLUMN deleted_at TIMESTAMPTZ;
UPDATE placements SET deleted_at = updated_at WHERE deleted;

DROP INDEX racks_warehouse_code_active_unique;
DROP INDEX racks_warehouse_active_idx;

UPDATE placements p
SET code = lower(btrim(p.code)) || CASE
    WHEN p.deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM placements o
        WHERE o.warehouse_id = p.warehouse_id
          AND o.deleted_at IS NULL
          AND o.id < p.id
          AND lower(btrim(o.code)) = lower(btrim(p.code)))
    THEN '-' || p.id
    ELSE ''
END;

ALTER TABLE placements DROP COLUMN deleted;
ALTER TABLE placements ADD CONSTRAINT placements_code_clean CHECK (code = lower(btrim(code)));

CREATE UNIQUE INDEX placements_warehouse_code_active_unique ON placements (warehouse_id, code) WHERE deleted_at IS NULL;
CREATE INDEX placements_warehouse_active_idx ON placements (warehouse_id) WHERE deleted_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX placements_warehouse_active_idx;
DROP INDEX placements_warehouse_code_active_unique;
ALTER TABLE placements DROP CONSTRAINT placements_code_clean;

ALTER TABLE placements ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE placements SET deleted = TRUE WHERE deleted_at IS NOT NULL;
ALTER TABLE placements DROP COLUMN deleted_at;

ALTER TABLE placements RENAME CONSTRAINT placements_code_present TO racks_code_present;
ALTER INDEX placements_pkey RENAME TO racks_pkey;
ALTER SEQUENCE placements_id_seq RENAME TO racks_id_seq;
ALTER TABLE placements RENAME TO racks;

CREATE UNIQUE INDEX racks_warehouse_code_active_unique ON racks (warehouse_id, code) WHERE deleted = FALSE;
CREATE INDEX racks_warehouse_active_idx ON racks (warehouse_id) WHERE deleted = FALSE;
-- +goose StatementEnd
