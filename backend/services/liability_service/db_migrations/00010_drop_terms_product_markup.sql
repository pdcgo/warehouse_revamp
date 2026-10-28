-- +goose Up
-- +goose StatementBegin
-- THE LEDGER READS NO MARKUP (the-ledger-charges-the-frozen-line-total).
--
-- The markup is the PRODUCT's — `products.cross_markup_bps` in product_service — applied once by inventory's take and
-- frozen on each order line's `total`. The product fee posts Σ the owning team's line totals as they arrive on
-- `OrderPlaced`, so this column was a second rate for one question, and the reason a fee could differ from the
-- invoice the order form showed. Dropped with its proto field and the frontend's pass-through, in one change.
--
-- The terms log's two markup columns go with it: a history of a term that no longer exists would record "0 → 0"
-- forever, which reads as a fact about a markup rather than the absence of one.
--
-- ⚠ THE CHECK IS REBUILT, NOT JUST LOST. `liability_terms_non_negative` names the markup beside the fee and the limit,
-- and Postgres drops a table constraint along with any column it involves — so dropping the column alone would also
-- silently drop the fee's and the limit's `>= 0`. It is dropped first and recreated over what remains.
--
-- Old fees: none in production to reinterpret (no-switch-over-the-ledgers-replace-todays-tables), so nothing is
-- back-filled and nothing is recomputed.
ALTER TABLE liability_terms
    DROP CONSTRAINT liability_terms_non_negative;

ALTER TABLE liability_terms
    DROP COLUMN product_markup_bp;

ALTER TABLE liability_terms
    ADD CONSTRAINT liability_terms_non_negative CHECK (
        handling_fee >= 0 AND (credit_limit IS NULL OR credit_limit >= 0)
    );

ALTER TABLE liability_terms_logs
    DROP COLUMN old_product_markup_bp,
    DROP COLUMN new_product_markup_bp;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ THE DOWN BRINGS THE COLUMNS BACK AT 0, NOT THE RATES. What a row held before the Up is gone, and a 0 is what a row
-- with no markup set always held — the honest restore, not a guess.
ALTER TABLE liability_terms_logs
    ADD COLUMN old_product_markup_bp BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN new_product_markup_bp BIGINT NOT NULL DEFAULT 0;

ALTER TABLE liability_terms
    DROP CONSTRAINT liability_terms_non_negative;

ALTER TABLE liability_terms
    ADD COLUMN product_markup_bp BIGINT NOT NULL DEFAULT 0;

ALTER TABLE liability_terms
    ADD CONSTRAINT liability_terms_non_negative CHECK (
        handling_fee >= 0 AND product_markup_bp >= 0 AND (credit_limit IS NULL OR credit_limit >= 0)
    );
-- +goose StatementEnd
