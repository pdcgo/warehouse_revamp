-- +goose Up
-- +goose StatementBegin
-- ANALYTIC'S EXPENSES BY TYPE (backlog #107; acceptance analytic/expense_metric.md givens 6–22 — *<type> shown* and the
-- total moving as Biaya's month total does; docs/business/analytic/rpc_provide_decision.md
-- the-expense-prototype-is-accepted's 🔄 2026-11-20 line; docs/business/financial_account/context_decision.md
-- expense-types-sit-under-groups, the-expense-types-prototype-is-accepted).
--
-- `type` is ExpenseType's NUMBER — the type the report row's expense rows are of (`expense_records.type`, since 00007),
-- so ExpensesMetric reads one field per type. Part of the key: a group's types never share a row.
--
-- 0 = UNTYPED: every report row written before this migration. Those rows keep their kind and flow and count in their
-- group's field and the total only, in no type field. No backfill here: a team's day is rebuilt from its
-- `expense_records` — types included — by `san report refold --report expense-daily --team <id> --date <day>`
-- (expense_v1/metric_refold.go), the fold's own key. No CHECK IN-list, as `kind` and `expense_records.type` (proto enums
-- are open and append-only); never negative.
ALTER TABLE expense_metric_daily_reports
    ADD COLUMN type INTEGER NOT NULL DEFAULT 0 CHECK (type >= 0);

DROP INDEX expense_metric_daily_reports_key_unique;
CREATE UNIQUE INDEX expense_metric_daily_reports_key_unique
    ON expense_metric_daily_reports (day, team_id, kind, flow, type, shop_id, user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Folding the types back into one row per old key: a down after typed rows were written sums them as 00007's fold would
-- have (one amount per day, team, kind, flow, shop and person), then the column goes.
CREATE TEMP TABLE expense_metric_type_merge ON COMMIT DROP AS
SELECT day, team_id, kind, flow, shop_id, user_id, MIN(id) AS keep_id, SUM(amount) AS amount
FROM expense_metric_daily_reports
GROUP BY day, team_id, kind, flow, shop_id, user_id;

UPDATE expense_metric_daily_reports r
SET amount = m.amount
FROM expense_metric_type_merge m
WHERE r.id = m.keep_id;

DELETE FROM expense_metric_daily_reports r
WHERE NOT EXISTS (SELECT 1 FROM expense_metric_type_merge m WHERE m.keep_id = r.id);

DROP INDEX expense_metric_daily_reports_key_unique;
ALTER TABLE expense_metric_daily_reports DROP COLUMN type;
CREATE UNIQUE INDEX expense_metric_daily_reports_key_unique
    ON expense_metric_daily_reports (day, team_id, kind, flow, shop_id, user_id);
-- +goose StatementEnd
