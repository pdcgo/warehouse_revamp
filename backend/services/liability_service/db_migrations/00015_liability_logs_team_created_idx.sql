-- +goose Up
-- +goose StatementBegin

-- THE STATEMENT'S PERIOD INDEX — a pure index (a-pure-index-is-added-without-asking): no query, write, constraint or
-- result changes.
--
-- LiabilityDaily reads one team's legs inside a Jakarta period (`team_id = ? AND created_at >= ? AND created_at < ?`)
-- and, now that the server groups months and years (periods-are-grouped-on-the-server), may read up to 20 years of them.
-- The only index starting with team_id was `liability_logs_pair_idx (team_id, counterparty_id, id DESC)`, which cannot
-- narrow by time: a month's read walked the team's whole history, or seq-scanned the table.
--
-- Measured (TestPerf_LiabilityDaily, a busy warehouse's 100 000 legs among 575 000, interleaved over three years):
-- a month daily 22.6 → 2.5 ms (generic plan 152 → 2.6 ms), a year daily 37 → 23.5 ms, a year monthly 38 → 24 ms,
-- three years yearly unchanged (it reads every leg of the team either way). Every write adds one entry to it.
CREATE INDEX liability_logs_team_created_idx ON liability_logs (team_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX liability_logs_team_created_idx;
-- +goose StatementEnd
