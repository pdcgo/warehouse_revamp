-- +goose Up
-- +goose StatementBegin
-- A free-text NOTE on the order, written by whoever took it (owner).
--
-- The one column on `orders` that the system never reads. It holds what the structured fields cannot:
-- "deliver after 5pm", "wrap the glass one", "second attempt, the first parcel came back". Those are
-- instructions to a PERSON — the CS who rings back, the crew who packs it — and every attempt to turn
-- that class of remark into an enum ends with a list nobody's actual case fits.
--
-- TEXT, not VARCHAR(n): the length limit belongs to the contract (2000 chars, in order.proto), and a
-- second limit in the schema would only ever be the one that disagrees. NOT NULL DEFAULT '' so every
-- existing row reads as "nothing written down" rather than as NULL — the same shape the address's
-- optional text columns already have, and it keeps every reader off a null check.
--
-- ⚠ Nothing may branch on this column. No index, no filter, no LIKE search: the moment something
-- queries it, that something needs a real field instead.
ALTER TABLE orders
    ADD COLUMN note TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN note;
-- +goose StatementEnd
