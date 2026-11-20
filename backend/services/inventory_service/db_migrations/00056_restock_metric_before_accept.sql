-- +goose Up
-- +goose StatementBegin
-- RESTOCK BEFORE THE ACCEPT on Analytic (docs/business/analytic/rpc_provide_decision.md —
-- the-restock-before-the-accept-prototype-is-accepted, a-cancelled-restock-takes-its-ordered-back-on-its-day,
-- a-lost-box-that-turns-up-takes-its-lost-back-on-its-day). The Restock metric reads, beside the accept's change rows,
-- a restock's facts that are NOT stock — so they go where the accept's door already writes them: the door report
-- (00042), keyed day × warehouse × owning team × product × supplier × source, written by inventory_ledgers.StockTransaction
-- as the transaction's last statements (one upsert, keys sorted). No second report, no second fold.
--
--   ordered_count / ordered_value  the create day: + each line's units and its share of the restock's total (goods + the
--                                  shipping its team paid — the-couriers-charge-stays-out-of-total — the shipping spread
--                                  over the units ORDERED as the landed price spreads it); an edit's DIFFERENCE on the
--                                  edit day (− what was, + what is: lines, shipping, a warehouse change out of the old
--                                  warehouse and into the new one); a cancel − on the cancel day. SIGNED.
--   lost_count / lost_value        the lost day: + the restock's lines as ordered then; − on the day a lost box is signed
--                                  for as arrived. SIGNED.
--   cod_amount                     the accept day: the courier's charge at the door, Terima's final figure, spread over
--                                  the units ordered like the shipping. ≥ 0.
--
-- Money is the exact double (the-backend-never-rounds-money). A return's door never carries them.
ALTER TABLE inventory_door_daily_reports
    ADD COLUMN ordered_count BIGINT           NOT NULL DEFAULT 0,
    ADD COLUMN ordered_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN lost_count    BIGINT           NOT NULL DEFAULT 0,
    ADD COLUMN lost_value    DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN cod_amount    DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Every existing row reads 0 in all five (the defaults), so both checks hold on the rows already there.
ALTER TABLE inventory_door_daily_reports ADD CONSTRAINT inventory_door_daily_reports_restock_only_check CHECK (
    source = 'restock'
    OR (ordered_count = 0 AND ordered_value = 0 AND lost_count = 0 AND lost_value = 0 AND cod_amount = 0));

ALTER TABLE inventory_door_daily_reports ADD CONSTRAINT inventory_door_daily_reports_cod_amount_check CHECK (cod_amount >= 0);

-- No history is replayed: like the door rows (00042) and Lost stock (lost-stock-is-not-backfilled), these count from the
-- build — revamp has no real restocks yet (revamp-has-no-real-orders-yet).
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE inventory_door_daily_reports DROP CONSTRAINT inventory_door_daily_reports_cod_amount_check;
ALTER TABLE inventory_door_daily_reports DROP CONSTRAINT inventory_door_daily_reports_restock_only_check;

ALTER TABLE inventory_door_daily_reports
    DROP COLUMN cod_amount,
    DROP COLUMN lost_value,
    DROP COLUMN lost_count,
    DROP COLUMN ordered_value,
    DROP COLUMN ordered_count;
-- +goose StatementEnd
