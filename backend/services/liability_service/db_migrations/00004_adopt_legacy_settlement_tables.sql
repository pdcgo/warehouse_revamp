-- +goose Up
-- +goose StatementBegin
-- ADOPTING THE ROWS THIS SERVICE USED TO OWN UNDER ITS OLD NAME.
--
-- The service renamed from `settlement_service` to `liability_service`, because the word `settlement`
-- now means the MARKETPLACE PAYOUT and this ledger is what TEAMS OWE EACH OTHER. The rename moves the
-- goose tracking table with it (`<service>_version`), so on a database that already ran the old
-- migrations goose sees an empty history and creates `liability_*` from scratch — correct, but it
-- leaves the real rows stranded in `settlement_*` where nothing reads them any more.
--
-- ⚠ THIS IS A ONE-WAY ADOPTION, and it is deliberately not a rename.
--
--   ALTER TABLE settlement_entries RENAME TO liability_entries
--
-- would be shorter and is wrong here: 00001-00003 have ALREADY created the `liability_*` tables by
-- the time this runs, so the rename would collide. Copying then dropping is what works from BOTH
-- starting points — a database that ran the old migrations, and a fresh one where none of these
-- tables ever existed.
--
-- On a FRESH database every block below is a no-op: `to_regclass` returns NULL, nothing is copied and
-- nothing is dropped. That is the point — one migration, both histories, no manual step and no
-- "run this by hand first" note that somebody will miss.
--
-- The schemas are identical column-for-column (these tables were created by the very migrations that
-- were renamed), so the copy names its columns explicitly rather than relying on `SELECT *` and
-- positional order. A future column added to one side and not the other should fail loudly here.
DO $$
BEGIN
    IF to_regclass('public.settlement_entries') IS NOT NULL THEN
        INSERT INTO liability_entries (
            id, team_id, counterparty_id, amount, source_type, source_id, reversal,
            group_id, balance_after, created_at
        )
        SELECT
            id, team_id, counterparty_id, amount, source_type, source_id, reversal,
            group_id, balance_after, created_at
        FROM settlement_entries;

        -- BIGSERIAL keeps its own sequence, and copying rows with explicit ids does NOT advance it.
        -- Without this the next insert reuses id 1 and fails on the primary key — a failure that
        -- would surface long after the migration, on whatever write happened to come first.
        PERFORM setval(
            pg_get_serial_sequence('liability_entries', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM liability_entries), 1)
        );
    END IF;

    IF to_regclass('public.settlement_balances') IS NOT NULL THEN
        INSERT INTO liability_balances (
            id, team_id, counterparty_id, balance, oldest_unsettled_at, created_at, updated_at
        )
        SELECT
            id, team_id, counterparty_id, balance, oldest_unsettled_at, created_at, updated_at
        FROM settlement_balances;

        PERFORM setval(
            pg_get_serial_sequence('liability_balances', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM liability_balances), 1)
        );
    END IF;

    IF to_regclass('public.settlement_terms') IS NOT NULL THEN
        INSERT INTO liability_terms (
            id, team_id, counterparty_id, handling_fee, product_markup_bp, credit_limit,
            created_at, updated_at
        )
        SELECT
            id, team_id, counterparty_id, handling_fee, product_markup_bp, credit_limit,
            created_at, updated_at
        FROM settlement_terms;

        PERFORM setval(
            pg_get_serial_sequence('liability_terms', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM liability_terms), 1)
        );
    END IF;

    IF to_regclass('public.settlement_payments') IS NOT NULL THEN
        INSERT INTO liability_payments (
            id, payer_team_id, creditor_team_id, amount, status, note, reversal_reason,
            recorded_by, confirmed_by, created_at, confirmed_at, updated_at
        )
        SELECT
            id, payer_team_id, creditor_team_id, amount, status, note, reversal_reason,
            recorded_by, confirmed_by, created_at, confirmed_at, updated_at
        FROM settlement_payments;

        PERFORM setval(
            pg_get_serial_sequence('liability_payments', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM liability_payments), 1)
        );
    END IF;
END
$$;

-- The group sequence is shared by every entry pair, so it carries over too — restarting it at 1 would
-- hand a fresh movement the group id of an existing one, and the two legs of a posting are found BY
-- that id.
DO $$
DECLARE
    legacy BIGINT;
BEGIN
    IF to_regclass('public.settlement_group_seq') IS NOT NULL THEN
        SELECT last_value INTO legacy FROM settlement_group_seq;
        PERFORM setval('liability_group_seq', GREATEST(legacy, 1));
    END IF;
END
$$;

-- ⚠ DROPPED LAST, and only after everything above committed. The old goose tracking table goes with
-- them: leaving `settlement_service_version` behind would make a future `settlement_service` — the
-- MARKETPLACE payout one, which is being built now — inherit a history that was never its own.
DROP TABLE IF EXISTS settlement_payments;
DROP TABLE IF EXISTS settlement_terms;
DROP TABLE IF EXISTS settlement_balances;
DROP TABLE IF EXISTS settlement_entries;
DROP SEQUENCE IF EXISTS settlement_group_seq;
DROP TABLE IF EXISTS settlement_service_version;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ NOT REVERSIBLE, and saying so is better than pretending.
--
-- Down would have to recreate four tables under their old names and move the rows back — but the
-- legacy tables were dropped, so their exact definition no longer exists anywhere except in the
-- git history of migrations that have themselves been renamed. Rolling back to a state this
-- migration deliberately destroyed is not something a Down block can honestly offer.
--
-- To go back: check out the commit before the rename and rebuild the database.
SELECT 1;
-- +goose StatementEnd
