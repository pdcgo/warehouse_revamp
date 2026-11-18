-- +goose Up
-- +goose StatementBegin
-- THE COD A WAREHOUSE PAID THIS MONTH (the-warehouse-sees-the-cod-it-paid, RestockCodPaidStat): a sum over the restocks a
-- warehouse ACCEPTED in a window. The warehouse side had only restocks_warehouse_idx (warehouse_id), so the month's sum
-- read every restock ever sent to the warehouse and filtered out all but the month's; the selling side's accepted dates
-- already have restocks_accepted_at_idx (team_id, accepted_at). Measured on 100 000 restocks, 50 000 into one warehouse
-- over four years (restock_cod_paid_stat_perf_test.go): this month 21.7 ms -> 0.56 ms, a year 21.7 ms -> 5.9 ms, four
-- years unchanged (the planner keeps the old index). Partial like its selling twin: a restock not accepted has no
-- accepted_at and is never in it. A pure index — no query, write or result changes (a-pure-index-is-added-without-asking).
CREATE INDEX restocks_warehouse_accepted_at_idx ON restocks (warehouse_id, accepted_at) WHERE accepted_at IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX restocks_warehouse_accepted_at_idx;
-- +goose StatementEnd
