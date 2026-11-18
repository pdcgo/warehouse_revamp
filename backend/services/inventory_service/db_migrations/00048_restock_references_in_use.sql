-- +goose Up
-- +goose StatementBegin

-- A REFERENCE IN USE STOPS THE RESTOCK (a-reference-in-use-stops-the-restock-form, docs/technical/frontend/
-- restock_decision.md) — the SERVER half. The form already refuses a resi or an Order ID another restock holds; nothing
-- behind it did, so two saves at the same second both passed, and so did any write not coming through the form. These two
-- indexes are that rule, kept by the database itself:
--   * the resi (`receipt`) and the Order ID (`invoice_ref_id`), EACH ON ITS OWN — one index each, so a resi is compared
--     only with resis and an Order ID only with Order IDs;
--   * against every other restock of THIS team (`team_id` leads the key) — a resi on ANOTHER team's restock is not
--     covered by the decision and is not refused here;
--   * held by any status but cancelled (`WHERE status <> 'cancelled'`) — a cancelled parcel never came; cancelling one
--     frees its references, and a cancel is final (nothing moves a restock out of cancelled);
--   * the match exact, letter case and the spaces around it aside (`lower(btrim(...))`): `jnt9988776655` is
--     ` JNT9988776655 `. The form trims what it sends, so through the form the stored value is already bare;
--   * an EMPTY reference holds nothing (the Order ID is optional, and an old restock may have no resi);
--   * the restock being edited is not its own duplicate — a unique index never compares a row with itself.
-- Unique, so two concurrent saves of one value cannot both commit: the second waits on the first's uncommitted row and
-- fails once it commits. inventory_v1 reads the refusal back as AlreadyExists naming the holder
-- (restock_reference_in_use.go). The predicate is written as LITERALS: a partial index is matched against literals only,
-- so the holder lookup repeats them word for word.
--
-- ⚠ THE GUARD. A database where two restocks of one team already share a reference would fail the CREATE with a bare
-- constraint error, so this REFUSES first — nothing created, the version not recorded — and the message lists every
-- such pair: the team, which reference, the value and each restock holding it with its status. Make them unique on that
-- (local) database, then migrate again (revamp-has-no-real-orders-yet: only dev rows can hold one).
DO $guard$
DECLARE
    held TEXT;
BEGIN
    SELECT string_agg(
               format('team %s %s %L: restocks %s', team_id, reference, value, holders),
               '; ' ORDER BY team_id, reference, value)
    INTO held
    FROM (
        SELECT team_id,
               'resi'                                                        AS reference,
               lower(btrim(receipt))                                         AS value,
               string_agg(id::text || ' ' || status, ', ' ORDER BY id)       AS holders
        FROM restocks
        WHERE status <> 'cancelled' AND btrim(receipt) <> ''
        GROUP BY team_id, lower(btrim(receipt))
        HAVING COUNT(*) > 1

        UNION ALL

        SELECT team_id,
               'Order ID',
               lower(btrim(invoice_ref_id)),
               string_agg(id::text || ' ' || status, ', ' ORDER BY id)
        FROM restocks
        WHERE status <> 'cancelled' AND btrim(invoice_ref_id) <> ''
        GROUP BY team_id, lower(btrim(invoice_ref_id))
        HAVING COUNT(*) > 1
    ) shared;

    IF held IS NOT NULL THEN
        RAISE EXCEPTION 'restocks of one team already share a reference (%) — a resi or an Order ID is held by one '
            'restock that is not cancelled (a-reference-in-use-stops-the-restock-form): change all but one of each on '
            'this (local) database, then migrate again', held;
    END IF;
END
$guard$;

CREATE UNIQUE INDEX restocks_receipt_in_use_idx
    ON restocks (team_id, lower(btrim(receipt)))
    WHERE status <> 'cancelled' AND btrim(receipt) <> '';

CREATE UNIQUE INDEX restocks_invoice_ref_in_use_idx
    ON restocks (team_id, lower(btrim(invoice_ref_id)))
    WHERE status <> 'cancelled' AND btrim(invoice_ref_id) <> '';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX restocks_invoice_ref_in_use_idx;
DROP INDEX restocks_receipt_in_use_idx;
-- +goose StatementEnd
