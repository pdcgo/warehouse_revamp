-- +goose Up
-- +goose StatementBegin
-- WHAT THE BUYER PAID ON THE MARKETPLACE, now on the DRAFT too (platform-total-is-required-at-finalize). An order
-- cannot be finalized without it, on either door — and Promote had nothing to copy, so every promoted draft became an
-- order with 0. The draft carries the figure now, and Promote copies it onto `orders.marketplace_total`.
--
-- Named `marketplace_total` to match the order's column; the move to `platform_total` is its own pass, both columns
-- at once.
--
-- 0 = not known yet, which a DRAFT may be while it is worked on: the app pushes it when the storefront shows it, a
-- person types it on the draft page. Finalize is where it becomes required — placeOrder refuses a 0 — so nothing
-- refuses it here. Whole rupiah, like the order's.
--
-- Not back-filled: no draft held a figure before this column, and the rows' scraped prices are not what the buyer paid.
--
-- No index: nothing searches or joins on it.
ALTER TABLE order_drafts
    ADD COLUMN marketplace_total BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_drafts
    DROP COLUMN marketplace_total;
-- +goose StatementEnd
