-- +goose Up
-- +goose StatementBegin
-- THE SUPPLIER REPORTS CARRY THE WAREHOUSE (docs/technical/frontend/suppliers_decision.md#the-supplier-reports-carry-the-warehouse):
-- both daily reports behind the Statistik tab gain the warehouse in their key — the warehouse a restock line was
-- RECEIVED at (RestockAccepted.warehouse_id; a received-count correction, its own event's), the warehouse an order line
-- was TAKEN from (the batch the order's take drew, inventory's OrderTakeSuppliers). Under a warehouse chip Statistik reads
-- that warehouse's rows; with no chip, the sum over every warehouse — the same figures as before this migration.
--
-- ⚠ ADDED AS 0, THEN RE-FOLDED — never truncated. 0 means "folded before the warehouse was recorded": such a row still
-- counts in every no-chip figure, so Statistik reads exactly what it read before at every moment, and under a chip it is
-- simply not that warehouse's. `san supplier backfill-warehouses` (run by `san dev setup`) then re-folds every supplier
-- day holding a 0 row from the fold's own claims and the other services' log, into the warehouse each line came from.
-- A migration could not do that itself: it may read only this service's tables, the dedup claims behind the restock
-- figures are pruned after 45 days (eventLogRetention — the re-fold reads inventory's accepts for those), and an order's
-- warehouse is inventory's. Truncating instead would blank the tab until the backfill ran and lose the pruned days.
--
-- The DEFAULT is dropped once the existing rows hold 0: every write from here on must NAME the warehouse, so a code path
-- that forgot it fails loudly instead of filing figures under "unknown".

-- RESTOCK, LOST, BROKEN — the warehouse the line was received at.
ALTER TABLE supplier_product_daily_reports ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE supplier_product_daily_reports ALTER COLUMN warehouse_id DROP DEFAULT;

-- The fold's upsert target, the warehouse last: day first still serves the replay's delete and every window scan.
DROP INDEX supplier_product_daily_reports_key_idx;
CREATE UNIQUE INDEX supplier_product_daily_reports_key_idx
    ON supplier_product_daily_reports (day, supplier_id, product_id, team_id, warehouse_id);

-- PENJUALAN — the warehouse the order's take drew the units from.
ALTER TABLE supplier_sale_daily_reports ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE supplier_sale_daily_reports ALTER COLUMN warehouse_id DROP DEFAULT;

DROP INDEX supplier_sale_daily_reports_key_idx;
CREATE UNIQUE INDEX supplier_sale_daily_reports_key_idx
    ON supplier_sale_daily_reports (day, supplier_id, product_id, team_id, warehouse_id);

-- WHAT ONE ORDER ADDED, per warehouse too — a cancel takes back exactly that, from the warehouse it was added to.
ALTER TABLE supplier_sale_order_parts ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE supplier_sale_order_parts ALTER COLUMN warehouse_id DROP DEFAULT;
ALTER TABLE supplier_sale_order_parts DROP CONSTRAINT supplier_sale_order_parts_pkey;
ALTER TABLE supplier_sale_order_parts ADD PRIMARY KEY (order_id, supplier_id, product_id, team_id, warehouse_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Folds the warehouses back together, so the old keys are unique again.
CREATE TEMP TABLE p6_parts ON COMMIT DROP AS
SELECT order_id, supplier_id, product_id, team_id, SUM(units) AS units, SUM(value) AS value
FROM supplier_sale_order_parts GROUP BY order_id, supplier_id, product_id, team_id;
DELETE FROM supplier_sale_order_parts;
ALTER TABLE supplier_sale_order_parts DROP CONSTRAINT supplier_sale_order_parts_pkey;
ALTER TABLE supplier_sale_order_parts DROP COLUMN warehouse_id;
INSERT INTO supplier_sale_order_parts (order_id, supplier_id, product_id, team_id, units, value)
SELECT order_id, supplier_id, product_id, team_id, units, value FROM p6_parts;
ALTER TABLE supplier_sale_order_parts ADD PRIMARY KEY (order_id, supplier_id, product_id, team_id);

CREATE TEMP TABLE p6_sales ON COMMIT DROP AS
SELECT day, supplier_id, product_id, team_id, SUM(sales_count) AS sales_count, SUM(sales_value) AS sales_value
FROM supplier_sale_daily_reports GROUP BY day, supplier_id, product_id, team_id;
DELETE FROM supplier_sale_daily_reports;
DROP INDEX supplier_sale_daily_reports_key_idx;
ALTER TABLE supplier_sale_daily_reports DROP COLUMN warehouse_id;
INSERT INTO supplier_sale_daily_reports (day, supplier_id, product_id, team_id, sales_count, sales_value)
SELECT day, supplier_id, product_id, team_id, sales_count, sales_value FROM p6_sales;
CREATE UNIQUE INDEX supplier_sale_daily_reports_key_idx
    ON supplier_sale_daily_reports (day, supplier_id, product_id, team_id);

CREATE TEMP TABLE p6_restock ON COMMIT DROP AS
SELECT day, supplier_id, product_id, team_id,
       SUM(restock_count) AS restock_count, SUM(restock_valuation) AS restock_valuation,
       SUM(shipping_lost_count) AS shipping_lost_count, SUM(shipping_lost_valuation) AS shipping_lost_valuation,
       SUM(shipping_broken_count) AS shipping_broken_count, SUM(shipping_broken_valuation) AS shipping_broken_valuation
FROM supplier_product_daily_reports GROUP BY day, supplier_id, product_id, team_id;
DELETE FROM supplier_product_daily_reports;
DROP INDEX supplier_product_daily_reports_key_idx;
ALTER TABLE supplier_product_daily_reports DROP COLUMN warehouse_id;
INSERT INTO supplier_product_daily_reports (day, supplier_id, product_id, team_id, restock_count, restock_valuation,
    shipping_lost_count, shipping_lost_valuation, shipping_broken_count, shipping_broken_valuation)
SELECT day, supplier_id, product_id, team_id, restock_count, restock_valuation,
       shipping_lost_count, shipping_lost_valuation, shipping_broken_count, shipping_broken_valuation
FROM p6_restock;
CREATE UNIQUE INDEX supplier_product_daily_reports_key_idx
    ON supplier_product_daily_reports (day, supplier_id, product_id, team_id);
-- +goose StatementEnd
