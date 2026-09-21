-- +goose Up
-- +goose StatementBegin
-- Where each accepted line was PUT (#137). Counting and shelving are one act: the warehouse says how
-- many turned up and which shelf they went on in the same breath, and this records the second half.
--
-- NULL = the unplaced pile — which covers two situations that this column alone does not distinguish:
-- a line received but not yet shelved, and a line on a request nobody has accepted yet. `status` and
-- `received_quantity` are what tell those apart, and neither is this column's job to duplicate.
--
-- A real FK, like stock_levels.rack_id: racks live in this same service. ON DELETE RESTRICT for the
-- same reason as there — a rack being deleted while a record points at it must be dealt with
-- explicitly (#138), never leave a request naming a location nobody can reach.
ALTER TABLE restock_request_items
    ADD COLUMN received_rack_id BIGINT REFERENCES racks (id) ON DELETE RESTRICT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restock_request_items
    DROP COLUMN received_rack_id;
-- +goose StatementEnd
