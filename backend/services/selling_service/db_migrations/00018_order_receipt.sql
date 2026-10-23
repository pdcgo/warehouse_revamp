-- +goose Up
-- +goose StatementBegin
-- THE TRACKING NUMBER — the owner's `orders.receipt` (order context.md): the number printed on the slip, what a
-- buyer chases a parcel by and what a label scan matches beside the marketplace ref
-- (a-label-scan-reads-the-ref-or-the-receipt).
--
-- Beside the `receipt_*` columns, which are the FILE the number is printed on — not a replacement for them. Stored
-- verbatim, never parsed: every courier formats its own.
--
-- '' = not recorded. True of every order placed before this column; nothing held the number before it, so there is
-- nothing to back-fill from. NOT unique and not indexed: the search reads it with a substring ILIKE, which no b-tree
-- serves, over the rows the scope has already narrowed.
ALTER TABLE orders
    ADD COLUMN receipt TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN receipt;
-- +goose StatementEnd
