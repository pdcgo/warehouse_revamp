-- +goose Up
-- +goose StatementBegin

-- THE RECEIVING WAREHOUSE'S OWN NOTE ON A RESTOCK (the-warehouse-writes-its-own-note, the-notes-are-one-per-writer,
-- docs/technical/frontend/restock_decision.md). A restock's notes have one writer each (three-notes-one-writer-each):
-- `restocks.note` is the selling team's, and until now nothing held the warehouse's — its restock page's Ubah wrote a note
-- that was thrown away. These four columns are that note and its OWN writer and time, exactly as 00050 keeps the selling
-- note's, written by inventory_v1's RestockRequestWarehouseNoteSet in one transaction with the trail's row:
--
--   * `warehouse_note` — the words, '' = none. Only the RECEIVING warehouse writes it; the selling team reads it.
--   * `warehouse_note_by_user_id` — an opaque user_service id, no FK, like `note_by_user_id`; 0 = never written.
--   * `warehouse_note_by_is_override` — the writer was Root or the Administrator acting in a team they hold no role in
--     (an-override-is-stamped-in-every-service), so the by-line can carry the shared badge.
--   * `warehouse_note_at` — NULL = never written.
--
-- Nothing is stamped at the raise: the raise is the selling team's, and the warehouse has written nothing then. FROM WHICH
-- STATUS the warehouse may write it is NOT decided (the owner: not his call); the columns hold no rule about it.
--
-- NO BACKFILL — there is nothing to fill: no warehouse note was ever kept, so every existing restock reads none.
ALTER TABLE restocks
    ADD COLUMN warehouse_note                TEXT        NOT NULL DEFAULT '',
    ADD COLUMN warehouse_note_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (warehouse_note_by_user_id >= 0),
    ADD COLUMN warehouse_note_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN warehouse_note_at             TIMESTAMPTZ;

-- ITS CHANGE IS A ROW OF THE TRAIL (edits-are-in-the-same-trail): a written warehouse note is an edit's row of
-- `restock_logs`, the status unchanged, with ONE change under it — the note before and after — so the field list
-- `restock_log_changes` CHECKs (00049) takes one more word. A field of the restock itself: product 0, no name.
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

-- +goose Down
-- +goose StatementBegin

-- The warehouse note's changes go with the note: the CHECK below no longer takes the word. Their trail rows stay, and
-- read as an edit with nothing under it — as an edit written before 00049 does.
DELETE FROM restock_log_changes WHERE field = 'warehouse_note';

ALTER TABLE restock_log_changes
    DROP CONSTRAINT restock_log_changes_field_check;

ALTER TABLE restock_log_changes
    ADD CONSTRAINT restock_log_changes_field_check CHECK (field IN (
        'warehouse', 'receipt', 'receipt_file', 'shipment', 'invoice_ref',
        'finance_account', 'shipment_cost', 'note',
        'line_added', 'line_removed', 'line_count', 'line_total', 'line_note',
        'line_supplier', 'line_store'
    ));

ALTER TABLE restocks
    DROP COLUMN warehouse_note_at,
    DROP COLUMN warehouse_note_by_is_override,
    DROP COLUMN warehouse_note_by_user_id,
    DROP COLUMN warehouse_note;

-- +goose StatementEnd
