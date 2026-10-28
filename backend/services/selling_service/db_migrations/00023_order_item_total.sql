-- +goose Up
-- +goose StatementBegin
-- EACH LINE'S FROZEN TOTAL (a-lines-money-is-frozen-at-finalize, the-ledger-charges-the-frozen-line-total).
--
-- What inventory's take priced the line at: the goods it drew plus, on another team's product, that product's own cross
-- markup (inventory-computes-the-markup — the order applies nothing, it freezes what the take returned). Written once,
-- in the order's own transaction, and never recomputed: a markup the owner raises next month must not rewrite what
-- this sale owed.
--
-- It is what the PRODUCT FEE is: liability posts Σ the owning team's line totals, read off `OrderPlaced`, and no
-- markup of its own.
--
-- DOUBLE PRECISION, unrounded, as the take returned it (rupiah-is-floating-point) — the same type as
-- `orders.warehouse_fee`. When a frozen figure is rounded is not decided; liability rounds at its own edge.
--
-- NULL = NEVER FROZEN: every line placed before this column. Deliberately not back-filled — the take's figures for
-- those orders were never kept, and a total rebuilt from today's markup would read as frozen when it is not.
--
-- Only `total` of the line's decided money columns (the-cross-charge-lives-on-the-line): it is the one a consumer
-- needs. `unit_cost_with_markup` and `markup_total` are not built.
ALTER TABLE order_items
    ADD COLUMN total DOUBLE PRECISION CHECK (total >= 0);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_items
    DROP COLUMN total;
-- +goose StatementEnd
