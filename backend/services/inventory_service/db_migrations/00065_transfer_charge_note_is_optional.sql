-- +goose Up
-- +goose StatementBegin
-- THE COURIER'S CHARGE NOTE IS OPTIONAL (the-couriers-charge-note-is-optional, which reverses
-- an-incidental-line-must-say-what-it-was-for): a warehouse transfer's charge at B's door is kept with or without what it
-- was for, as a restock's and a reshipping's already are (their columns never carried a CHECK). 00027 made the old rule a
-- CHECK on the row, so the accept that stopped refusing in the handler would still fail at the database — dropped here.
-- No row changes: every row already satisfies the looser rule.
ALTER TABLE warehouse_transfers
    DROP CONSTRAINT warehouse_transfers_charge_has_note;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ Fails while any transfer holds a charge with no note (accepted since the Up): give those a note first.
ALTER TABLE warehouse_transfers
    ADD CONSTRAINT warehouse_transfers_charge_has_note
        CHECK (warehouse_additional_cost = 0 OR warehouse_additional_cost_note <> '');
-- +goose StatementEnd
