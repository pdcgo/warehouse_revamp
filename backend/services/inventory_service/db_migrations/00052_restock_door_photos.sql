-- +goose Up
-- +goose StatementBegin

-- THE PHOTOS TAKEN AT THE DOOR, KEPT (docs/technical/frontend/restock_decision.md): at Terima the receiving warehouse may
-- photograph a line's broken units (a-broken-product-carries-a-photo — one per line, optional) and the courier's slip
-- for the charge it paid at the door (the-courier-slip-has-an-optional-photo — one per restock, optional). Both detail
-- pages read them back (the-detail-pages-show-the-broken-photo, the-detail-pages-show-the-slip-and-the-broken-rack).
--
-- Each is a document_service document id — the warehouse's own upload, stored the way the restock's label photo is
-- (`restocks.receipt_file`): an order-receipt upload, read back through a signed link that inventory asks for once it
-- has checked the caller is the restock's selling team or its warehouse. '' = no photo.
--
--   * `restock_problem_items.photo_file` — the broken units' photo, on the line's BROKEN row (the row is keyed by
--     restock and product, one per kind, so it is one photo per line). A missing row never carries one: nothing is
--     there to photograph — the CHECK says so.
--   * `restocks.warehouse_additional_cost_file` — the courier's slip, beside the charge and its note it belongs to (one
--     charge per restock, the-courier-is-paid-once-per-restock). Written by the accept only with a charge above 0.
--
-- Old rows read '' — no photo was ever kept before this; nothing is backfilled.
ALTER TABLE restock_problem_items
    ADD COLUMN photo_file TEXT NOT NULL DEFAULT '',
    ADD CONSTRAINT restock_problem_items_photo_is_broken CHECK (photo_file = '' OR problem_type = 'broken');

ALTER TABLE restocks
    ADD COLUMN warehouse_additional_cost_file TEXT NOT NULL DEFAULT '';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restocks
    DROP COLUMN warehouse_additional_cost_file;

ALTER TABLE restock_problem_items
    DROP CONSTRAINT restock_problem_items_photo_is_broken,
    DROP COLUMN photo_file;
-- +goose StatementEnd
