-- +goose Up
-- A LINE'S PRICE IS ITS TOTAL, NOT ITS PER-UNIT COST (#140, owner).
--
-- People buying stock think in totals: "that box of 12 cost 240.000". Asking for a per-unit figure
-- makes them do the division in their head, and whatever they type back is a rounded number whose
-- product no longer equals the sum they actually paid.
--
-- So the TOTAL is what is stored — exactly the number a person typed off an invoice — and any
-- per-unit figure is DERIVED at read time and known to be derived. 10.000 over 3 pieces stays 10.000
-- here; the 3.333 that StockCost computes is openly a rounding, and the 1 rupiah it drops is never
-- written back over the truth.
--
-- The existing rows hold a PER-UNIT price, so they are converted, not just renamed. Multiplying by
-- quantity reproduces exactly the total those rows always implied.
ALTER TABLE restock_request_items RENAME COLUMN price TO total_price;

UPDATE restock_request_items SET total_price = total_price * quantity;

-- +goose Down
-- Integer division, so this is LOSSY: a total that did not divide evenly comes back rounded down, and
-- the original figure cannot be recovered. Down is for a local mistake, not for production.
UPDATE restock_request_items SET total_price = total_price / quantity;

ALTER TABLE restock_request_items RENAME COLUMN total_price TO price;
