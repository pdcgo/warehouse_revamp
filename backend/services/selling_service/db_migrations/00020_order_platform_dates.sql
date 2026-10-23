-- +goose Up
-- +goose StatementBegin
-- THE PLATFORM'S TWO DATES — the owner's `platform_created_at` and `platform_shipment_deadline`, on `orders` and on
-- `order_drafts` (order context.md §Table That Must Have).
--
--   platform_created_at         when the BUYER ordered on the storefront, beside `created_at` (when WE wrote the row).
--                               Required when an order is placed, on both doors
--                               (platform-created-at-is-required-at-finalize) — checked in code, not here: every
--                               order before this column has none, and a draft may hold it empty while it is worked on.
--   platform_shipment_deadline  the marketplace's own ship-by time, its "kirim sebelum"
--                               (the-shipment-deadline-is-the-platforms-and-optional). Optional everywhere.
--
-- NULL = not recorded. Not back-filled: nothing held either date before, and a guess would read as the platform's.
--
-- No index on platform_created_at, the same as created_at: the list's date window is read over rows the team scope has
-- already narrowed (the-date-filter-switches-created-or-platform).
ALTER TABLE orders
    ADD COLUMN platform_created_at TIMESTAMPTZ,
    ADD COLUMN platform_shipment_deadline TIMESTAMPTZ;

ALTER TABLE order_drafts
    ADD COLUMN platform_created_at TIMESTAMPTZ,
    ADD COLUMN platform_shipment_deadline TIMESTAMPTZ;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_drafts
    DROP COLUMN platform_shipment_deadline,
    DROP COLUMN platform_created_at;

ALTER TABLE orders
    DROP COLUMN platform_shipment_deadline,
    DROP COLUMN platform_created_at;
-- +goose StatementEnd
