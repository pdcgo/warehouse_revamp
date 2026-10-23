-- +goose Up
-- +goose StatementBegin
-- WHAT A WAREHOUSE CHARGES PER ORDER (warehouse-prices-balance-records) — warehouse_service's first table, the fee
-- configuration of the owner's §Property 3 (fee_percent, max_fee) plus the decided floor (min_fee).
--
-- ONE ROW PER WAREHOUSE, the same rate for every seller (one-rate-per-warehouse):
--   fee = clamp(goods_cost × fee_percent / 100, min_fee, max_fee)   (the-fee-has-a-floor-and-a-cap)
-- max_fee NULL = no cap; 0 is refused (an-empty-cap-means-no-cap). NO ROW = the warehouse never set its fee, and takes no
-- orders (a-warehouse-with-no-rate-takes-no-orders) — 0% is a rate, a missing row is not.
--
-- Money is DOUBLE PRECISION (rupiah-is-floating-point). warehouse_id is a team_service team, opaque, no FK.
--
-- Step 1 of the-flat-rate-is-dropped-last: nothing charges from this table yet.
CREATE TABLE warehouse_fees (
    id           BIGSERIAL        PRIMARY KEY,
    warehouse_id BIGINT           NOT NULL,
    fee_percent  DOUBLE PRECISION NOT NULL CHECK (fee_percent >= 0 AND fee_percent <= 100),
    min_fee      DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (min_fee >= 0),
    max_fee      DOUBLE PRECISION          CHECK (max_fee > 0),
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),

    -- A floor above the cap is refused; equal is a flat fee.
    CONSTRAINT warehouse_fees_floor_under_cap CHECK (max_fee IS NULL OR min_fee <= max_fee)
);

-- One per warehouse — and what lets Set be one INSERT … ON CONFLICT, so two managers saving at once leave one row.
CREATE UNIQUE INDEX warehouse_fees_warehouse_idx ON warehouse_fees (warehouse_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE warehouse_fees;
-- +goose StatementEnd
