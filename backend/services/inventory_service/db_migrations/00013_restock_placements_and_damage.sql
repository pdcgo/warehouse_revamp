-- +goose Up
-- WHAT ACTUALLY HAPPENED WHEN THE BOX WAS OPENED (#154).
--
-- Two facts the old shape could not hold, and both are ordinary at a receiving door:
--
--   1. A delivery of 100 does not go on one shelf. `received_rack_id` allowed exactly one place per
--      line, so a real put-away had to be recorded as a lie and corrected afterwards with #136 moves.
--   2. Some of it arrives broken. There was nowhere to say so, so damaged units either entered stock
--      (and could be picked, and would fail at the shelf) or vanished from the record entirely.

-- Where a received line's goods were put. One row per (line, place).
CREATE TABLE restock_received_placements (
    id BIGSERIAL PRIMARY KEY,
    restock_request_item_id BIGINT NOT NULL
        REFERENCES restock_request_items (id) ON DELETE CASCADE,

    -- NULL is the UNPLACED PILE (#135) — "received, not shelved yet". A real, workable place, not a
    -- missing answer: it is what a partial put-away looks like, and #136 is how it gets shelved later.
    -- ON DELETE RESTRICT, like every other rack reference: a shelf holding stock cannot be deleted out
    -- from under it (#138).
    rack_id BIGINT REFERENCES racks (id) ON DELETE RESTRICT,

    -- How many went to THIS place. A placement of zero is not a placement, so it is refused rather
    -- than stored as a row that says nothing happened.
    quantity BIGINT NOT NULL CHECK (quantity > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A line names each place ONCE. Two rows for the same shelf would be one placement written twice,
    -- and summing them is not the same as the person having meant it.
    --
    -- NULLS NOT DISTINCT (PG 15+) is what makes that true of the unplaced pile as well: without it,
    -- NULL <> NULL and a line could carry two "unplaced" rows.
    CONSTRAINT restock_placement_unique UNIQUE NULLS NOT DISTINCT (restock_request_item_id, rack_id)
);

CREATE INDEX restock_received_placements_item_idx
    ON restock_received_placements (restock_request_item_id);

-- What arrived broken or never arrived at all. NEVER enters stock (owner, 2026-07-20).
--
-- Kept as rows rather than as a free-text note on the line, because the whole point is that it is a
-- NUMBER something can total: what this supplier costs in breakage is a question with an answer only
-- if the losses are counted.
CREATE TABLE restock_damaged_units (
    id BIGSERIAL PRIMARY KEY,
    restock_request_item_id BIGINT NOT NULL
        REFERENCES restock_request_items (id) ON DELETE CASCADE,

    quantity BIGINT NOT NULL CHECK (quantity > 0),

    -- Why. Required and non-empty: a loss with no reason is a number nobody can act on, and "some
    -- went missing" is the kind of record that gets written once and never chased.
    reason TEXT NOT NULL CHECK (reason <> ''),

    -- What those units were worth, whole rupiah. 0 is legitimate — a free sample can still arrive
    -- crushed — so it is >= 0, not > 0.
    value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX restock_damaged_units_item_idx ON restock_damaged_units (restock_request_item_id);

-- Carry the existing single placements across. A line that received nothing has no placement, which
-- is the same thing the new shape says by having no rows.
INSERT INTO restock_received_placements (restock_request_item_id, rack_id, quantity)
SELECT id, received_rack_id, received_quantity
FROM restock_request_items
WHERE received_quantity > 0;

-- Superseded by the table above. Dropped rather than left in place: two sources for "where did it go"
-- is how they start disagreeing.
ALTER TABLE restock_request_items DROP COLUMN received_rack_id;

-- +goose Down
ALTER TABLE restock_request_items ADD COLUMN received_rack_id BIGINT REFERENCES racks (id) ON DELETE RESTRICT;

-- LOSSY, and unavoidably so: a line split across three shelves cannot go back into one column. The
-- largest placement wins and the rest are dropped. Down is for a local mistake, not for production.
UPDATE restock_request_items i
SET received_rack_id = p.rack_id
FROM (
    SELECT DISTINCT ON (restock_request_item_id) restock_request_item_id, rack_id
    FROM restock_received_placements
    ORDER BY restock_request_item_id, quantity DESC
) p
WHERE p.restock_request_item_id = i.id;

DROP TABLE restock_damaged_units;
DROP TABLE restock_received_placements;
