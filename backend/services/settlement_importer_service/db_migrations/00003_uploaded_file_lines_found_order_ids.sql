-- +goose Up
-- +goose StatementBegin
-- A LINE WHOSE REF FOUND TWO OR MORE LIVE ORDERS posts to the shop, and names every order it found, so a person can
-- place the money (two-live-orders-on-a-ref-post-to-the-shop). The ids are other services' (selling_service orders),
-- kept as given: comma-joined, ascending, '' for every other line. Nothing joins or filters on them — the line's
-- `reason` (several_orders) is what the file page filters by.
ALTER TABLE uploaded_file_lines ADD COLUMN found_order_ids TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE uploaded_file_lines DROP COLUMN found_order_ids;
-- +goose StatementEnd
