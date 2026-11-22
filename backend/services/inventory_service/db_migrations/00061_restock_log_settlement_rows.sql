-- +goose Up
-- +goose StatementBegin
-- THE SETTLEMENT IN THE RESTOCK'S RIWAYAT (backlog #101 — the owner's 🔄 on a-restock-problem-is-settled-by-resolution-rows
-- and the-restock-resolutions-prototype-is-accepted): one REAL trail row per resolution recorded, per *Tandai Selesai*
-- and per reopen (an inbound parcel's Terima with short or broken units), each written in the transaction of what it
-- records and never rewritten — settled → reopened → settled reads all three.
--
-- Each is a `restock_logs` row (00024) keeping the status (from = to, as an edit's), told apart by its stored word in
-- `description` ('resolution recorded' / 'settled' / 'reopened' — the column is free text, nothing widens there). What
-- such a row names rides `restock_log_changes` (00049), whose field CHECK takes four more words:
--   resolution     the resolution's id (restock_resolutions.id), product 0
--   parcel         the inbound parcel that reopened it (custom_shipments.id), product 0
--   parcel_short   per product, the units the parcel came short
--   parcel_broken  per product, the units broken in it
-- and its "a line's fields name their line" CHECK (00049: product set ⇔ a `line_` field) takes the two per-product
-- words too. Existing rows are untouched: each widened CHECK still holds every one.
ALTER TABLE restock_log_changes
    DROP CONSTRAINT restock_log_changes_field_check;

ALTER TABLE restock_log_changes
    ADD CONSTRAINT restock_log_changes_field_check CHECK (field IN (
        'warehouse', 'receipt', 'receipt_file', 'shipment', 'invoice_ref',
        'finance_account', 'shipment_cost', 'note', 'warehouse_note',
        'line_added', 'line_removed', 'line_count', 'line_total', 'line_note',
        'line_supplier', 'line_store',
        'resolution', 'parcel', 'parcel_short', 'parcel_broken'
    ));

-- 00049's unnamed table CHECK, as Postgres named it.
ALTER TABLE restock_log_changes
    DROP CONSTRAINT restock_log_changes_check;

ALTER TABLE restock_log_changes
    ADD CONSTRAINT restock_log_changes_check
        CHECK ((field LIKE 'line\_%' OR field IN ('parcel_short', 'parcel_broken')) = (product_id > 0));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- The settlement's changes go with the words: the CHECK below no longer takes them. Their trail rows stay, and read as
-- a row of their stored word with nothing under it.
DELETE FROM restock_log_changes WHERE field IN ('resolution', 'parcel', 'parcel_short', 'parcel_broken');

ALTER TABLE restock_log_changes
    DROP CONSTRAINT restock_log_changes_check;

ALTER TABLE restock_log_changes
    ADD CONSTRAINT restock_log_changes_check CHECK ((field LIKE 'line\_%') = (product_id > 0));

ALTER TABLE restock_log_changes
    DROP CONSTRAINT restock_log_changes_field_check;

ALTER TABLE restock_log_changes
    ADD CONSTRAINT restock_log_changes_field_check CHECK (field IN (
        'warehouse', 'receipt', 'receipt_file', 'shipment', 'invoice_ref',
        'finance_account', 'shipment_cost', 'note', 'warehouse_note',
        'line_added', 'line_removed', 'line_count', 'line_total', 'line_note',
        'line_supplier', 'line_store'
    ));

-- +goose StatementEnd
