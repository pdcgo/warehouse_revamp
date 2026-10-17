-- +goose Up
-- +goose StatementBegin
-- THE RESTOCK TABLES TAKE THE OWNER'S NAMES (restock.md §Table Should We Have In Restock), and their money turns DOUBLE
-- in the same migration (money-is-double-in-the-api-too). 00024 put the decided columns under today's names; the
-- names were left for the commit that moved the accept onto the ledgers, which rewrote the readers that join them.
-- Nothing is in production (no-switch-over-the-ledgers-replace-todays-tables), so nothing here has to stay readable by
-- the code before it.
--
--   restock_requests       → restocks
--   restock_request_items  → restock_items
--   restock_damaged_units  → restock_problem_items, keyed by restock + product (its product finds its line)
--   restock_logs           keeps its name; its key follows the restock

-- 1. restocks.
ALTER TABLE restock_requests RENAME TO restocks;
ALTER SEQUENCE restock_requests_id_seq RENAME TO restocks_id_seq;
ALTER INDEX restock_requests_pkey RENAME TO restocks_pkey;

ALTER TABLE restocks RENAME COLUMN requesting_team_id TO team_id;
-- The store's invoice or order number (a-restock-has-one-invoice). `order_ref` held it since 00006.
ALTER TABLE restocks RENAME COLUMN order_ref TO invoice_ref_id;
ALTER TABLE restocks RENAME COLUMN shipping_cost TO shipment_cost;
-- The courier is `shipment_id` (00024); the free-text code before it was never on the contract's restock.
ALTER TABLE restocks DROP COLUMN shipping_code;

ALTER TABLE restocks RENAME CONSTRAINT restock_requests_shipping_cost_non_negative TO restocks_shipment_cost_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_created_by_user_id_check TO restocks_created_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_accepted_by_user_id_check TO restocks_accepted_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_cancelled_by_user_id_check TO restocks_cancelled_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_shipment_id_check TO restocks_shipment_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_finance_account_id_check TO restocks_finance_account_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_transaction_id_check TO restocks_transaction_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_warehouse_additional_cost_check
    TO restocks_warehouse_additional_cost_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_arrived_by_user_id_check TO restocks_arrived_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restock_requests_lost_by_user_id_check TO restocks_lost_by_user_id_check;

ALTER INDEX restock_requests_requesting_team_idx RENAME TO restocks_team_idx;
ALTER INDEX restock_requests_warehouse_idx RENAME TO restocks_warehouse_idx;
ALTER INDEX idx_restock_requests_accepted_at RENAME TO restocks_accepted_at_idx;
ALTER INDEX idx_restock_requests_cancelled_at RENAME TO restocks_cancelled_at_idx;

--    The money, double (stock-money-is-float64-compared-at-4-digits). `subtotal` is Σ line totals and `total` adds the
--    shipping — never the courier's charge (the-couriers-charge-stays-out-of-total). Stored now, written by every create
--    and edit, so the list and a report read them without summing the lines.
ALTER TABLE restocks
    ALTER COLUMN shipment_cost TYPE DOUBLE PRECISION,
    ALTER COLUMN warehouse_additional_cost TYPE DOUBLE PRECISION,
    ADD COLUMN subtotal DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    ADD COLUMN total    DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total >= 0);

-- 2. restock_items.
ALTER TABLE restock_request_items RENAME TO restock_items;
ALTER SEQUENCE restock_request_items_id_seq RENAME TO restock_items_id_seq;
ALTER INDEX restock_request_items_pkey RENAME TO restock_items_pkey;

ALTER TABLE restock_items RENAME COLUMN restock_request_id TO restock_id;
ALTER TABLE restock_items RENAME COLUMN quantity TO count;
ALTER TABLE restock_items RENAME COLUMN total_price TO total;
ALTER TABLE restock_items RENAME COLUMN received_quantity TO received_count;

ALTER TABLE restock_items RENAME CONSTRAINT restock_request_items_quantity_positive TO restock_items_count_check;
ALTER TABLE restock_items RENAME CONSTRAINT restock_request_items_price_non_negative TO restock_items_total_check;
ALTER TABLE restock_items RENAME CONSTRAINT restock_request_items_restock_request_id_fkey TO restock_items_restock_id_fkey;
ALTER TABLE restock_items RENAME CONSTRAINT restock_request_items_supplier_id_check TO restock_items_supplier_id_check;
ALTER TABLE restock_items RENAME CONSTRAINT restock_request_items_supplier_channel_id_check
    TO restock_items_supplier_channel_id_check;

ALTER INDEX restock_request_items_request_idx RENAME TO restock_items_restock_idx;
ALTER INDEX restock_request_items_product_once RENAME TO restock_items_product_once;

--    `price_unit` is total ÷ count, for display (a-line-is-typed-as-its-total): the total stays the truth, and the
--    unit price is worked out from it whenever either changes, never typed.
ALTER TABLE restock_items
    ALTER COLUMN total TYPE DOUBLE PRECISION,
    ADD COLUMN price_unit DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (price_unit >= 0);

UPDATE restock_items SET price_unit = total / count;

UPDATE restocks r
SET subtotal = s.subtotal,
    total    = s.subtotal + r.shipment_cost
FROM (SELECT restock_id, SUM(total) AS subtotal FROM restock_items GROUP BY restock_id) s
WHERE s.restock_id = r.id;

-- 3. restock_problem_items — what did not become stock at the door, keyed by restock and product: a product appears
--    once per restock (a-product-appears-once-per-restock), so its product finds its line and no item id is needed.
--    One row per kind, like the transfer's.
CREATE TABLE restock_problem_items (
    id                  BIGSERIAL        PRIMARY KEY,
    restock_id          BIGINT           NOT NULL,
    product_id          BIGINT           NOT NULL CHECK (product_id > 0),
    -- The line's store, copied (restock.md: "supplier_channel_id, its optionals"). A supplier_service id: no FK.
    supplier_channel_id BIGINT           CHECK (supplier_channel_id > 0),
    problem_type        TEXT             NOT NULL CHECK (problem_type IN ('broken', 'missing')),
    count               BIGINT           NOT NULL CHECK (count > 0),
    -- The landed unit price, filled by the system (the-problem-price-is-filled-by-the-system).
    price_unit          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (price_unit >= 0),
    total               DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total >= 0),
    -- The warehouse's note, optional (a-broken-reason-is-optional, three-notes-one-writer-each).
    note                TEXT             NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    -- The row's line, by the key the line is unique on.
    CONSTRAINT restock_problem_items_line_fkey FOREIGN KEY (restock_id, product_id)
        REFERENCES restock_items (restock_id, product_id) ON DELETE CASCADE,
    CONSTRAINT restock_problem_items_one_per_kind UNIQUE (restock_id, product_id, problem_type)
);

--    Several rows of one kind on one line become one: counts and totals add, notes join.
INSERT INTO restock_problem_items
    (restock_id, product_id, supplier_channel_id, problem_type, count, price_unit, total, note, created_at)
SELECT i.restock_id,
       i.product_id,
       i.supplier_channel_id,
       d.damage_type,
       SUM(d.quantity),
       MAX(d.price_unit),
       SUM(d.total),
       COALESCE(string_agg(NULLIF(d.reason, ''), '; ' ORDER BY d.id), ''),
       MIN(d.created_at)
FROM restock_damaged_units d
JOIN restock_items i ON i.id = d.restock_request_item_id
GROUP BY i.restock_id, i.product_id, i.supplier_channel_id, d.damage_type;

--    `received_quantity` stored the GOOD units; `received_count` is what was in the box, broken included
--    (any-warehouse-member-counts-what-arrived), so the broken rows go back in.
UPDATE restock_items i
SET received_count = i.received_count + p.count
FROM restock_problem_items p
WHERE p.restock_id = i.restock_id
  AND p.product_id = i.product_id
  AND p.problem_type = 'broken';

DROP TABLE restock_damaged_units;

-- 4. restock_logs: its key follows the restock, and `at` folds into `created_at` (every-status-change-is-logged names
--    created_at). `at` was kept apart for 00024's backfill, which wrote history; those rows keep their moment.
ALTER TABLE restock_logs RENAME COLUMN restock_request_id TO restock_id;
ALTER TABLE restock_logs RENAME CONSTRAINT restock_logs_restock_request_id_fkey TO restock_logs_restock_id_fkey;

UPDATE restock_logs SET created_at = at;

DROP INDEX idx_restock_logs_restock;
ALTER TABLE restock_logs DROP COLUMN at;
CREATE INDEX restock_logs_restock_idx ON restock_logs (restock_id, created_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ NOT A ROUND TRIP. The names and the key go back; problem rows merged in Up stay merged, a log row's `at` comes back
-- as its created_at, and money returns to whole rupiah, rounded. Nothing is in production — a developer's database is
-- reseeded rather than trusted to this.
DROP INDEX restock_logs_restock_idx;
ALTER TABLE restock_logs ADD COLUMN at TIMESTAMPTZ;
UPDATE restock_logs SET at = created_at;
ALTER TABLE restock_logs ALTER COLUMN at SET NOT NULL;
ALTER TABLE restock_logs RENAME CONSTRAINT restock_logs_restock_id_fkey TO restock_logs_restock_request_id_fkey;
ALTER TABLE restock_logs RENAME COLUMN restock_id TO restock_request_id;
CREATE INDEX idx_restock_logs_restock ON restock_logs (restock_request_id, at, id);

CREATE TABLE restock_damaged_units (
    id                      BIGSERIAL   PRIMARY KEY,
    restock_request_item_id BIGINT      NOT NULL REFERENCES restock_items (id) ON DELETE CASCADE,
    quantity                BIGINT      NOT NULL CHECK (quantity > 0),
    reason                  TEXT        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    damage_type             TEXT        NOT NULL DEFAULT '',
    price_unit              BIGINT      NOT NULL DEFAULT 0 CHECK (price_unit >= 0),
    total                   BIGINT      NOT NULL DEFAULT 0 CHECK (total >= 0)
);
CREATE INDEX restock_damaged_units_item_idx ON restock_damaged_units (restock_request_item_id);

UPDATE restock_items i
SET received_count = i.received_count - p.count
FROM restock_problem_items p
WHERE p.restock_id = i.restock_id
  AND p.product_id = i.product_id
  AND p.problem_type = 'broken';

INSERT INTO restock_damaged_units (restock_request_item_id, quantity, reason, created_at, damage_type, price_unit, total)
SELECT i.id, p.count, p.note, p.created_at, p.problem_type, ROUND(p.price_unit)::BIGINT, ROUND(p.total)::BIGINT
FROM restock_problem_items p
JOIN restock_items i ON i.restock_id = p.restock_id AND i.product_id = p.product_id;

DROP TABLE restock_problem_items;

ALTER TABLE restock_items DROP COLUMN price_unit;
ALTER TABLE restock_items ALTER COLUMN total TYPE BIGINT USING ROUND(total)::BIGINT;
ALTER INDEX restock_items_product_once RENAME TO restock_request_items_product_once;
ALTER INDEX restock_items_restock_idx RENAME TO restock_request_items_request_idx;
ALTER TABLE restock_items RENAME CONSTRAINT restock_items_supplier_channel_id_check
    TO restock_request_items_supplier_channel_id_check;
ALTER TABLE restock_items RENAME CONSTRAINT restock_items_supplier_id_check TO restock_request_items_supplier_id_check;
ALTER TABLE restock_items RENAME CONSTRAINT restock_items_restock_id_fkey TO restock_request_items_restock_request_id_fkey;
ALTER TABLE restock_items RENAME CONSTRAINT restock_items_total_check TO restock_request_items_price_non_negative;
ALTER TABLE restock_items RENAME CONSTRAINT restock_items_count_check TO restock_request_items_quantity_positive;
ALTER TABLE restock_items RENAME COLUMN received_count TO received_quantity;
ALTER TABLE restock_items RENAME COLUMN total TO total_price;
ALTER TABLE restock_items RENAME COLUMN count TO quantity;
ALTER TABLE restock_items RENAME COLUMN restock_id TO restock_request_id;
ALTER INDEX restock_items_pkey RENAME TO restock_request_items_pkey;
ALTER SEQUENCE restock_items_id_seq RENAME TO restock_request_items_id_seq;
ALTER TABLE restock_items RENAME TO restock_request_items;

ALTER TABLE restocks DROP COLUMN total, DROP COLUMN subtotal;
ALTER TABLE restocks
    ALTER COLUMN warehouse_additional_cost TYPE BIGINT USING ROUND(warehouse_additional_cost)::BIGINT,
    ALTER COLUMN shipment_cost TYPE BIGINT USING ROUND(shipment_cost)::BIGINT;
ALTER INDEX restocks_cancelled_at_idx RENAME TO idx_restock_requests_cancelled_at;
ALTER INDEX restocks_accepted_at_idx RENAME TO idx_restock_requests_accepted_at;
ALTER INDEX restocks_warehouse_idx RENAME TO restock_requests_warehouse_idx;
ALTER INDEX restocks_team_idx RENAME TO restock_requests_requesting_team_idx;
ALTER TABLE restocks RENAME CONSTRAINT restocks_lost_by_user_id_check TO restock_requests_lost_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_arrived_by_user_id_check TO restock_requests_arrived_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_warehouse_additional_cost_check
    TO restock_requests_warehouse_additional_cost_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_transaction_id_check TO restock_requests_transaction_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_finance_account_id_check TO restock_requests_finance_account_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_shipment_id_check TO restock_requests_shipment_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_cancelled_by_user_id_check TO restock_requests_cancelled_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_accepted_by_user_id_check TO restock_requests_accepted_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_created_by_user_id_check TO restock_requests_created_by_user_id_check;
ALTER TABLE restocks RENAME CONSTRAINT restocks_shipment_cost_check TO restock_requests_shipping_cost_non_negative;
ALTER TABLE restocks ADD COLUMN shipping_code TEXT NOT NULL DEFAULT '';
ALTER TABLE restocks RENAME COLUMN shipment_cost TO shipping_cost;
ALTER TABLE restocks RENAME COLUMN invoice_ref_id TO order_ref;
ALTER TABLE restocks RENAME COLUMN team_id TO requesting_team_id;
ALTER INDEX restocks_pkey RENAME TO restock_requests_pkey;
ALTER SEQUENCE restocks_id_seq RENAME TO restock_requests_id_seq;
ALTER TABLE restocks RENAME TO restock_requests;
-- +goose StatementEnd
