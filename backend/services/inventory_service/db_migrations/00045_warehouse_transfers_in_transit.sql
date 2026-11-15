-- +goose Up
-- +goose StatementBegin
-- THE TEAM'S TRANSFERS IN TRANSIT, BY TEAM. OwnerStockByIds and OwnerStockStat read a team's transfers between their two
-- legs (created, process, shipped, arrived, lost — the-transfer-is-where-goods-in-transit-are) for the in-transit
-- figure, and only `warehouse_transfers_team_idx (team_id, id DESC)` led with the team: every read walked the team's
-- whole transfer history to keep its few hundred open ones, and the stat's sum went to a seq scan of the table. A
-- partial index over exactly that predicate holds only the open transfers (4-5 ms -> ~1-2 ms at 10 000 transfers per
-- team with 200 open; docs/services/inventory_service/rpc.md, OwnerStockByIds / OwnerStockStat). The predicate is written
-- with LITERALS, as the reads write it, so the planner can match it.
CREATE INDEX warehouse_transfers_in_transit_idx ON warehouse_transfers (team_id, to_warehouse_id)
    WHERE outbound_transaction_id IS NOT NULL AND status IN ('created', 'process', 'shipped', 'arrived', 'lost');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX warehouse_transfers_in_transit_idx;
-- +goose StatementEnd
