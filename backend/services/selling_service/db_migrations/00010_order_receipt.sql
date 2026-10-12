-- +goose Up
-- +goose StatementBegin
-- The SHIPPING RECEIPT attached to an order (owner): the courier's slip photographed, or the PDF the
-- marketplace prints. One per order.
--
-- A REFERENCE to a document_service document, not the file and not a URL. The id is opaque — no FK
-- across services (HARD RULE 3) — and the document is private, so the only thing a URL column could
-- hold is either a link that expires or a permanently public one for a file naming a buyer and their
-- address. Viewing goes through DocumentService.GetDownloadUrl, scoped to the team.
--
-- The two labels are a SNAPSHOT, exactly as the address and the line items are: the order list can
-- show that an order has a receipt, and whether it is a picture or a PDF, without calling another
-- service per row. They are what the file was called when it was attached, and they stay that way.
--
-- '' means NO RECEIPT — the ordinary state of an order, and of every row predating this column.
ALTER TABLE orders
    ADD COLUMN receipt_document_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN receipt_filename    TEXT NOT NULL DEFAULT '',
    ADD COLUMN receipt_mime_type   TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN receipt_document_id,
    DROP COLUMN receipt_filename,
    DROP COLUMN receipt_mime_type;
-- +goose StatementEnd
