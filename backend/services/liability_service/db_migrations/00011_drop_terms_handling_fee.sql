-- +goose Up
-- +goose StatementBegin
-- THE FLAT RATE IS DROPPED LAST (the-flat-rate-is-dropped-last, step 5).
--
-- Since step 4 the ledger posts the fee each ORDER froze (the-event-carries-the-warehouse-fee): warehouse_service prices
-- it at create, `orders.warehouse_fee` keeps it, `OrderPlaced` carries it. Nothing has read this column since, except
-- step 2's one-off carry-over into warehouse_service, which goes with it. A flat fee left here would be a field a person
-- can set that charges nothing.
--
-- ⚠ THE LOG KEEPS ITS TWO COLUMNS. `liability_terms_logs.old_handling_fee` / `new_handling_fee` are the history of a
-- term that DID charge, from #189 until the switch-over — unlike the markup's (00010), they record real money. Never
-- written again.
--
-- ⚠ THE CHECK IS REBUILT, NOT JUST LOST, for the reason 00010 gives: Postgres drops a table constraint along with any
-- column it involves, which would silently drop the limit's `>= 0` too.
ALTER TABLE liability_terms
    DROP CONSTRAINT liability_terms_non_negative;

ALTER TABLE liability_terms
    DROP COLUMN handling_fee;

ALTER TABLE liability_terms
    ADD CONSTRAINT liability_terms_non_negative CHECK (credit_limit IS NULL OR credit_limit >= 0);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ THE DOWN BRINGS THE COLUMN BACK AT 0, NOT THE RATES. What a row held before the Up is gone; the last value of each
-- is in the terms log, and 0 is what charges nothing — the honest restore, not a guess.
ALTER TABLE liability_terms
    DROP CONSTRAINT liability_terms_non_negative;

ALTER TABLE liability_terms
    ADD COLUMN handling_fee BIGINT NOT NULL DEFAULT 0;

ALTER TABLE liability_terms
    ADD CONSTRAINT liability_terms_non_negative CHECK (
        handling_fee >= 0 AND (credit_limit IS NULL OR credit_limit >= 0)
    );
-- +goose StatementEnd
