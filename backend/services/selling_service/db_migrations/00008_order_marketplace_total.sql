-- +goose Up
-- +goose StatementBegin
-- What the order SOLD FOR on the marketplace — a NOTE, not a term of the sum (owner).
--
-- This is the one number on an order that nothing computes from. `total` stays `subtotal +
-- shipping_cost`, and this sits beside it recording what the storefront actually took: after the
-- marketplace's vouchers, coin subsidies and promotions, what the buyer paid there is genuinely a
-- different figure from what this order's lines add up to, and neither one is wrong.
--
-- It is stored rather than derived because NOTHING can derive it. The marketplace's arithmetic is not
-- ours and is not visible from here; a person reads it off the storefront and types it in.
--
-- 0 means NOT RECORDED, not "sold for nothing" — the field is optional, and an order taken over the
-- phone has no marketplace figure at all. Every row predating this column is in that position, which
-- is honest: nobody wrote it down, and back-filling it from `total` would be inventing a number that
-- happens to look plausible.
--
-- ⚠ Do NOT add this to any revenue or margin calculation. `margin = total - cogs - shipping_cost`
-- still holds, and folding this in would double-count the sale.
ALTER TABLE orders
    ADD COLUMN marketplace_total BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN marketplace_total;
-- +goose StatementEnd
