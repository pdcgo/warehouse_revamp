-- +goose Up
-- Root or the Administrator writing inside a team they hold no role in is recorded as such
-- (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service). Stamped on the rows that record
-- one ACT and its actor:
--   inventory_transactions   every stock change; batch_logs and product_placement_logs are its lines and read the flag
--                            through transaction_id
--   restock_logs             every restock status change and edit
--   warehouse_transfer_logs  every transfer status change
-- The state rows `restocks` and `warehouse_transfers` carry one actor column PER ACT, so one flag there could not say
-- which act it meant — each act's log row carries it instead. Rows before this migration read as no override, which is
-- what nobody recorded.
ALTER TABLE inventory_transactions  ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE restock_logs            ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE warehouse_transfer_logs ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE warehouse_transfer_logs DROP COLUMN is_override;
ALTER TABLE restock_logs            DROP COLUMN is_override;
ALTER TABLE inventory_transactions  DROP COLUMN is_override;
