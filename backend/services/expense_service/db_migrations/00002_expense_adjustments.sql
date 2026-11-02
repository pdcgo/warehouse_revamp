-- +goose Up
-- AN EXPENSE IS NEVER EDITED; A MISTAKE IS A NEW ROW (every-correction-is-a-signed-adjustment).
--
-- An ADJUSTMENT is a row of this table that names the expense it corrects. It copies that expense's team, shop, kind and
-- day — so every total, the per-kind split and the daily statement keep summing rows, and the correction lands in the
-- month that holds the mistake (an-adjustment-counts-on-the-day-it-fixes). Void is no longer a concept: nothing marks a
-- row voided, because a row never changes.

-- 0 on an expense. On an adjustment, the expense it corrects — always an expense, never another adjustment (the handler
-- keeps it so; a correction of a correction is a second correction of the same expense).
ALTER TABLE expense_records ADD COLUMN adjusts_expense_id BIGINT NOT NULL DEFAULT 0;

-- The old CHECK said every amount is positive. An adjustment is signed, so the rule becomes one per kind of row.
ALTER TABLE expense_records DROP CONSTRAINT expense_records_amount_check;

-- Every row voided until now becomes its expense plus an adjustment of minus its amount — dev data only, so its total
-- is unchanged and the retraction stays visible as a row. Who voided it was never recorded; the expense's own author
-- stands in, at the moment it was voided.
INSERT INTO expense_records (team_id, shop_id, kind, amount, occurred_at, note, created_by, adjusts_expense_id, created_at, updated_at)
SELECT team_id, shop_id, kind, -amount, occurred_at, 'voided before adjustments existed', created_by, id, voided_at, voided_at
FROM expense_records
WHERE voided_at IS NOT NULL;

-- An expense is positive; an adjustment is signed and never 0. That the two never sum below 0 is the handler's, under
-- the expense row's lock — a CHECK cannot see the other rows.
ALTER TABLE expense_records ADD CONSTRAINT expense_records_amount_sign CHECK (
    (adjusts_expense_id = 0 AND amount > 0) OR (adjusts_expense_id > 0 AND amount <> 0)
);

-- The period read no longer filters out voided rows — every row counts.
DROP INDEX expense_records_team_period_idx;
CREATE INDEX expense_records_team_period_idx ON expense_records (team_id, occurred_at DESC, id DESC);

-- An expense's adjustments, for its net and for the floor.
CREATE INDEX expense_records_adjusts_idx ON expense_records (adjusts_expense_id) WHERE adjusts_expense_id > 0;

ALTER TABLE expense_records DROP COLUMN voided_at;

-- +goose Down
-- ⚠ LOSSY: an expense its adjustments bring to 0 reads as voided again, and every adjustment is deleted — a partial
-- correction is lost.
ALTER TABLE expense_records ADD COLUMN voided_at TIMESTAMPTZ;

UPDATE expense_records e
SET voided_at = NOW()
WHERE e.adjusts_expense_id = 0
  AND e.amount + COALESCE((SELECT SUM(a.amount) FROM expense_records a WHERE a.adjusts_expense_id = e.id), 0) = 0;

DELETE FROM expense_records WHERE adjusts_expense_id > 0;

DROP INDEX expense_records_adjusts_idx;
DROP INDEX expense_records_team_period_idx;
CREATE INDEX expense_records_team_period_idx
    ON expense_records (team_id, occurred_at DESC, id DESC)
    WHERE voided_at IS NULL;

ALTER TABLE expense_records DROP CONSTRAINT expense_records_amount_sign;
ALTER TABLE expense_records ADD CONSTRAINT expense_records_amount_check CHECK (amount > 0);
ALTER TABLE expense_records DROP COLUMN adjusts_expense_id;
