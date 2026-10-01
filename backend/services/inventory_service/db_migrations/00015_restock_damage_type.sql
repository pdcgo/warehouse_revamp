-- +goose Up
-- HOW a unit failed to become stock, and no longer WHAT IT WAS WORTH (#154, owner 2026-07-23).
--
-- The accept screen stopped asking for a rupiah value: warehouse staff know a box is crushed at the
-- door, not what it cost, and nothing read the number. In its place a TYPE — broken on arrival, or
-- lost from the box — which is the distinction a supplier report actually needs ("how much did they
-- send us broken" is not "how much did they short us").
--
-- Stored as TEXT and guarded by the mapper, not a DB CHECK IN-list (cf. #80) — one more place to drift
-- when the enum grows. Existing rows (design-stage only) get '' and read back as UNSPECIFIED.
ALTER TABLE restock_damaged_units ADD COLUMN damage_type TEXT NOT NULL DEFAULT '';
ALTER TABLE restock_damaged_units DROP COLUMN value;

-- +goose Down
ALTER TABLE restock_damaged_units ADD COLUMN value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0);
ALTER TABLE restock_damaged_units DROP COLUMN damage_type;
