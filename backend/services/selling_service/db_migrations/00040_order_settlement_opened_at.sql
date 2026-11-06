-- +goose Up
-- +goose StatementBegin
-- WHEN THE ORDER'S SETTLEMENT ACCOUNT OPENED (docs/business/settlement/context_decision.md#a-missing-account-is-found-by-its-opened-at).
-- Stamped once by settlement, through an in-process seam, when the first `initial_total` for the order is posted — from
-- Order Placed, by hand on the order page, or from an imported statement. NULL = NOT YET: the open failed, is
-- dead-lettered, or never ran; the order still committed. OrderList's `settlement_not_opened` filter lists exactly those.
ALTER TABLE orders ADD COLUMN settlement_opened_at TIMESTAMPTZ;

-- The orders still missing an account are FEW once things run (each one is a failure a person is about to fix), so a
-- partial index holds only them: the filter reads that short list, newest first, instead of every order in scope.
CREATE INDEX orders_settlement_not_opened_idx ON orders (id) WHERE settlement_opened_at IS NULL;
-- +goose StatementEnd

-- +goose StatementBegin
-- THE FILL — developer databases only (revamp-has-no-real-orders-yet). An existing order whose account DID open gets the
-- time its first `initial_total` was written, so NULL keeps meaning "missing" on a dev database too; every other order
-- stays NULL, which is the truth about it.
--
-- ⚠ It READS settlement's `settlement_logs`, once, and writes only `orders` — the one place a selling migration looks
-- at another service's table, acceptable only because it is a one-off fill of development rows. Guarded by to_regclass
-- so a fresh database, where `migrate up-all` runs selling before settlement has created the table, applies it as a
-- no-op: nothing has opened there yet.
DO $$
BEGIN
    IF to_regclass('settlement_logs') IS NOT NULL THEN
        UPDATE orders o
        SET settlement_opened_at = opened.at
        FROM (
            SELECT order_id, MIN(created_at) AS at
            FROM settlement_logs
            WHERE settlement_type = 'initial_total' AND order_id IS NOT NULL
            GROUP BY order_id
        ) opened
        WHERE opened.order_id = o.id;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX orders_settlement_not_opened_idx;
ALTER TABLE orders DROP COLUMN settlement_opened_at;
-- +goose StatementEnd
