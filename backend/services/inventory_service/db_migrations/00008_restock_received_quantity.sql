-- +goose Up
-- +goose StatementBegin
-- What actually ARRIVED, counted by the warehouse as it accepted the restock (#133).
--
-- `quantity` is what was ASKED FOR; this is what turned up, and stock receives THIS number. Both are
-- kept side by side rather than the asked-for being overwritten, because the GAP between them is the
-- point — it is what someone chases the supplier about, and a row that quietly said 9 were asked for
-- would erase the very discrepancy it exists to record.
--
-- DEFAULT 0 is right for the backfill as much as for new rows: a line is uncounted until its request
-- is accepted, and every request predating this column is still pending — nothing has been received
-- against any of them, so 0 is the true value here, not a placeholder standing in for one.
--
-- No CHECK against `quantity`: a short delivery (9 of 10) is ordinary and an over-delivery (11 of 10)
-- is real. The column records what was counted, and the person counting is the authority.
ALTER TABLE restock_request_items
    ADD COLUMN received_quantity BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restock_request_items
    DROP COLUMN received_quantity;
-- +goose StatementEnd
