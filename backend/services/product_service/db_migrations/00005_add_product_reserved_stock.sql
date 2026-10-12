-- +goose Up
-- +goose StatementBegin
ALTER TABLE products
    -- RESERVED STOCK: a hold-back BUFFER, not a quantity of anything.
    --
    -- How many units of this product are never offered for sale, so that whatever is physically on
    -- the shelf, `available = on_hand - reserved_stock`. It is the answer to "never sell the last
    -- N": the margin that absorbs a count that drifted, a unit damaged where nobody logged it, or
    -- two orders landing in the same second — none of which should end as an oversell.
    --
    -- It lives on the PRODUCT and not on a stock row because it is a decision about the ITEM, taken
    -- once by whoever owns the catalogue, and it holds wherever the thing is stocked. The physical
    -- per-warehouse counts stay in inventory_service; this column only tells it how much of each
    -- count is off limits.
    --
    -- UNITS, matching how stock is counted everywhere else — a percentage of a shelf would round to
    -- fractions of a physical object. NOT NULL DEFAULT 0 so every existing row has a defined answer
    -- (hold nothing back, which is how the catalogue has behaved until now) rather than a NULL each
    -- reader would interpret for itself.
    ADD COLUMN reserved_stock INT NOT NULL DEFAULT 0,

    -- A buffer cannot be negative — that would read as "sell more than we have", which is the exact
    -- thing this column exists to prevent. The ceiling is a sanity rail, not a policy: a million
    -- units is far past any real buffer and still catches a quantity typed into the wrong field.
    ADD CONSTRAINT products_reserved_stock_range CHECK (reserved_stock BETWEEN 0 AND 1000000);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE products
    DROP CONSTRAINT products_reserved_stock_range,
    DROP COLUMN reserved_stock;
-- +goose StatementEnd
