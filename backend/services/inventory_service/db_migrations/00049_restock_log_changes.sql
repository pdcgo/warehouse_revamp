-- +goose Up
-- +goose StatementBegin

-- WHAT AN EDIT CHANGED (edits-are-in-the-same-trail, docs/business/inventory/restock_decision.md). An edit is a row of
-- `restock_logs` whose status did not move; until now it said only "edited". Each row here is ONE thing that edit
-- changed, before and after — *Kaos 10 → 12, extra stock* is a `line_count` row and a `line_note` row — written in the
-- edit's own transaction, beside its log row.
--
--   * ONE ROW PER CHANGED FIELD, not a blob on the log row: a field is a fixed shape (which field, which line, before,
--     after), and a new table leaves `restock_logs` itself untouched.
--   * A LINE is named by its product (a product appears once per restock, a-product-appears-once-per-restock) and by
--     the name the restock carried for it at the edit — the restock's own snapshot, so a line removed later still reads.
--     A field of the restock itself has product 0 and no name.
--   * THE VALUES ARE TEXT as the edit saw them: a count or an amount in decimal, an id in decimal, words verbatim; ''
--     is none (no before for an added line, no after for a removed one or a cleared note).
--   * APPEND ONLY, like the trail it belongs to: nothing updates or deletes a row; it goes when its log row goes.
--   * NO BACKFILL. An edit written before this table has no rows here and keeps reading as it did — nothing invents
--     what an old edit changed.
CREATE TABLE restock_log_changes (
    id             BIGSERIAL   PRIMARY KEY,
    restock_log_id BIGINT      NOT NULL REFERENCES restock_logs (id) ON DELETE CASCADE,

    field          TEXT        NOT NULL CHECK (field IN (
                                   'warehouse', 'receipt', 'receipt_file', 'shipment', 'invoice_ref',
                                   'finance_account', 'shipment_cost', 'note',
                                   'line_added', 'line_removed', 'line_count', 'line_total', 'line_note',
                                   'line_supplier', 'line_store'
                               )),

    -- The line it is about, 0 for the restock's own field — and the line's name as the restock carried it.
    product_id     BIGINT      NOT NULL DEFAULT 0 CHECK (product_id >= 0),
    product_name   TEXT        NOT NULL DEFAULT '',

    before_value   TEXT        NOT NULL DEFAULT '',
    after_value    TEXT        NOT NULL DEFAULT '',

    -- A line's fields name their line; the restock's own never do.
    CHECK ((field LIKE 'line\_%') = (product_id > 0))
);

-- The one read: the changes of a restock's trail rows, in the order each edit wrote them (Detail's preload).
CREATE INDEX restock_log_changes_log_idx ON restock_log_changes (restock_log_id, id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE restock_log_changes;
-- +goose StatementEnd
