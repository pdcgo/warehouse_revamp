-- +goose Up
-- +goose StatementBegin
-- THE EXPENSE TYPES (docs/business/financial_account/context_decision.md — expense-types-sit-under-groups,
-- prive-and-deposit-on-pengeluaran-are-the-accounts-capital, money-in-on-biaya-is-its-own-change-type,
-- the-expense-types-prototype-is-accepted).
--
-- `expense_records.type` is ExpenseType's NUMBER — the type a person picked; `kind` stays and is its GROUP, written
-- from it. 0 = a row recorded BEFORE the types: it keeps its kind and no type (no guessed backfill — the decision), and
-- a STOCK_LOSS. An adjustment copies its expense's. No CHECK IN-list, as `kind` (00001: proto enums are open and
-- append-only). Each type's group, direction and capital flag are expense_v1/expense_types.go's fixed table.
ALTER TABLE expense_records ADD COLUMN type INTEGER NOT NULL DEFAULT 0;

-- THE ANALYTIC REPORT'S FLOW — which figure of ExpensesMetric a row counts in: 0 spending (`ads · payroll ·
-- operational · other · total`), 1 money in, 2 capital out (Prive), 3 capital in (Setoran modal). Every row written so
-- far is spending (before the types every kind was money out), so the default is exact for them. Part of the key, so a
-- group's spending and its money in never share a row.
ALTER TABLE expense_metric_daily_reports
    ADD COLUMN flow SMALLINT NOT NULL DEFAULT 0 CHECK (flow BETWEEN 0 AND 3);

DROP INDEX expense_metric_daily_reports_key_unique;
CREATE UNIQUE INDEX expense_metric_daily_reports_key_unique
    ON expense_metric_daily_reports (day, team_id, kind, flow, shop_id, user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Folding the flows back into one row per old key: a down after typed rows were written sums them as the old fold
-- would have (one amount per key), then the column goes.
CREATE TEMP TABLE expense_metric_flow_merge ON COMMIT DROP AS
SELECT day, team_id, kind, shop_id, user_id, MIN(id) AS keep_id, SUM(amount) AS amount
FROM expense_metric_daily_reports
GROUP BY day, team_id, kind, shop_id, user_id;

UPDATE expense_metric_daily_reports r
SET amount = m.amount
FROM expense_metric_flow_merge m
WHERE r.id = m.keep_id;

DELETE FROM expense_metric_daily_reports r
WHERE NOT EXISTS (SELECT 1 FROM expense_metric_flow_merge m WHERE m.keep_id = r.id);

DROP INDEX expense_metric_daily_reports_key_unique;
ALTER TABLE expense_metric_daily_reports DROP COLUMN flow;
CREATE UNIQUE INDEX expense_metric_daily_reports_key_unique
    ON expense_metric_daily_reports (day, team_id, kind, shop_id, user_id);

ALTER TABLE expense_records DROP COLUMN type;
-- +goose StatementEnd
