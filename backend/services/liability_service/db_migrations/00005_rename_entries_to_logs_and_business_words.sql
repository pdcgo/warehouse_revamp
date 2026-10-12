-- +goose Up
-- +goose StatementBegin
-- THREE DECIDED CHANGES, ONE PASS OVER THE LEDGER.
--
--   1. the-ledger-speaks-the-business-words  — source_type takes the business's vocabulary
--   2. every-entry-names-who-posted-it       — an actor_id column
--   3. two-logs-two-names                    — `liability_entries` becomes `liability_logs`
--
-- They are together because they touch the same table and the same rows. Run separately, each is a
-- full pass over a 141-file surface and three rewrites of history.

-- ── 3. THE RENAME ────────────────────────────────────────────────────────────────────────────────
--
-- The `liability` prefix STAYS (liability-stays) — only the suffix moves. The screen this table
-- backs is a change log, and the design docs call it one.
--
-- ⚠ ITS ROWS ARE STILL NOT INDEPENDENT. One posting is TWO rows sharing `group_id`, so a single row
-- is half a movement. The name says what the screen shows; `PostEntry` being the only writer is what
-- makes a half-movement impossible.
ALTER TABLE liability_entries RENAME TO liability_logs;

-- Postgres renames the table but NOT its indexes, its constraint or its sequence, so a later reader
-- would find `liability_entries_source_idx` on a table of that name no longer. Renamed explicitly
-- rather than left to rot: an index whose name lies about its table is how the next person looks in
-- the wrong place.
ALTER INDEX liability_entries_source_idx RENAME TO liability_logs_source_idx;
ALTER INDEX liability_entries_pair_idx RENAME TO liability_logs_pair_idx;
ALTER TABLE liability_logs RENAME CONSTRAINT liability_entries_sides_differ TO liability_logs_sides_differ;
ALTER SEQUENCE liability_entries_id_seq RENAME TO liability_logs_id_seq;

-- ── 2. THE ACTOR ─────────────────────────────────────────────────────────────────────────────────
--
-- WHO CAUSED THE MOVEMENT — a user id, opaque here. Not the service and not the event: the human
-- whose act produced it, which is what a team disputing a charge has to be able to see.
--
-- ⚠ DEFAULT 0 IS A CONFESSION, NOT A VALUE. Every row written before today carries it, and none of
-- them can be back-filled — the fact was never recorded anywhere to recover it from. Going forward 0
-- means a genuinely unattended posting (a scheduled job), and nothing writes one.
ALTER TABLE liability_logs
    ADD COLUMN actor_id BIGINT NOT NULL DEFAULT 0;

-- ── 1. THE BUSINESS WORDS ────────────────────────────────────────────────────────────────────────
--
-- The business word says WHEN the fee is charged. `handling_fee` said only that some handling
-- happened.
UPDATE liability_logs SET source_type = 'order_fee' WHERE source_type = 'handling_fee';

-- `restock_outlay` and the `cod_fee` it superseded are one thing: the courier's unplanned ask on
-- arrival plus whatever else the warehouse paid to get the delivery in. INCIDENTAL by nature, which
-- is why no closed list of kinds can enumerate it.
--
-- ⚠ `cod_fee` is folded in here rather than left alone. It was superseded and never posted again, so
-- any surviving row is the same money under an abandoned name — and the proto has reserved its
-- number, so nothing can read it any more.
UPDATE liability_logs SET source_type = 'incidental_fee'
 WHERE source_type IN ('restock_outlay', 'cod_fee');

-- ⚠ THE LOSSY ONE, AND IT CANNOT BE MADE OTHERWISE. `stock_damage` carried three business movements
-- under one name, and the distinction was thrown away at the call site — `StockAdjustReason` had
-- DAMAGED, LOST and FOUND, and `PostStockDamage` collapsed them into a single boolean.
--
-- What survives is the boolean: `reversal` is TRUE only for a giving-back movement, which is exactly
-- FOUND. Everything else was broken OR lost and there is no column that says which.
--
--   reversal = TRUE   → `found`        — recoverable, and correct
--   reversal = FALSE  → `broken_good`  — a GUESS, and it lands on one of the two
--
-- It lands on `broken_good` rather than `lost_good` because a warehouse that adjusts stock down
-- against a batch most often does it for damage it can see. That is a judgement, not a fact, and it
-- is written here so nobody later reads these rows as authoritative. Every day this waited added
-- more of them.
UPDATE liability_logs SET source_type = 'found'
 WHERE source_type = 'stock_damage' AND reversal = TRUE;

UPDATE liability_logs SET source_type = 'broken_good'
 WHERE source_type = 'stock_damage';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ THE DOWN IS NOT A ROUND TRIP, and cannot be.
--
-- `broken_good` and `lost_good` both go back to `stock_damage`, so a row split apart by a later
-- correction is re-merged and the distinction is lost again. `found` returns to `stock_damage` with
-- its reversal flag, which IS recoverable. Rolling forward again would then re-guess.
--
-- `incidental_fee` returns to `restock_outlay` for every row — the `cod_fee` rows folded into it on
-- the way up do not come back, because nothing recorded which they were.
UPDATE liability_logs SET source_type = 'stock_damage'
 WHERE source_type IN ('broken_good', 'lost_good', 'found');

UPDATE liability_logs SET source_type = 'restock_outlay' WHERE source_type = 'incidental_fee';
UPDATE liability_logs SET source_type = 'handling_fee' WHERE source_type = 'order_fee';

ALTER TABLE liability_logs DROP COLUMN actor_id;

ALTER SEQUENCE liability_logs_id_seq RENAME TO liability_entries_id_seq;
ALTER TABLE liability_logs RENAME CONSTRAINT liability_logs_sides_differ TO liability_entries_sides_differ;
ALTER INDEX liability_logs_pair_idx RENAME TO liability_entries_pair_idx;
ALTER INDEX liability_logs_source_idx RENAME TO liability_entries_source_idx;

ALTER TABLE liability_logs RENAME TO liability_entries;
-- +goose StatementEnd
