-- +goose Up
-- +goose StatementBegin
-- THE MARKETPLACE'S OWN ID for the order — what the storefront calls it (owner).
--
-- Our `id` is meaningless to everybody outside this system. When a buyer writes in, when the
-- marketplace's support is asked about a dispute, or when somebody is reconciling a payout against
-- what we shipped, THIS is the number in their hand. Without it, matching an order to anything that
-- happened on the storefront is done by customer name and a date, which is a guess.
--
-- Stored VERBATIM and never parsed. Every marketplace formats its reference differently, and any
-- structure imposed here would be a rule the next storefront breaks. TEXT rather than a bounded
-- VARCHAR for the same reason — the contract caps it at 128 (matching order_drafts.external_id), and
-- the column does not need a second, weaker opinion about the same limit.
--
-- '' = there is NO marketplace reference. That is the ordinary state of an order taken over the
-- phone, and of every row predating this column — not "unknown", and nothing to back-fill: an order
-- that never had one never will.
--
-- ⚠ NOT UNIQUE, and deliberately so for now. A unique index would make the field detect
-- double-entry, which is genuinely the most likely error it could catch — but it would also refuse
-- a legitimate re-entry after a cancel, and it needs to be partial (WHERE order_external_ref_id
-- <> '') or the empty default collides with itself on the second phone order. Whether two orders may
-- share one reference is an OPEN QUESTION for the owner; enforcing it before that is decided would
-- reject real work.
--
-- No index either: the only reader today is OrderList's free-text search, which is ILIKE '%term%'
-- and cannot use a btree. An index for a lookup nothing performs is a write cost with no reader.
ALTER TABLE orders
    ADD COLUMN order_external_ref_id TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN order_external_ref_id;
-- +goose StatementEnd
