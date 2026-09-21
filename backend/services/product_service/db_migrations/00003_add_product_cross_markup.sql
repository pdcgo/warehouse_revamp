-- +goose Up
-- +goose StatementBegin
ALTER TABLE products
    -- CROSS SELLING: another team puts OUR product on ITS order, and we charge a markup for it.
    --
    -- Stored in BASIS POINTS (1/100 of a percent), not as a decimal percent: 1250 = 12.50%. An
    -- integer cannot drift the way a float does, and this number multiplies money — a markup that
    -- rounds differently on two screens is a dispute between two teams, not a display bug. The UI
    -- reads and writes plain percent; bps is only how it is kept.
    --
    -- 0 = no markup: the other team pays what we paid. NOT NULL DEFAULT 0 so every existing row has
    -- a defined answer rather than a NULL each reader would have to interpret for itself.
    ADD COLUMN cross_markup_bps INT NOT NULL DEFAULT 0,

    -- A markup cannot be negative — that would be handing another team our goods BELOW cost, which
    -- nobody should be able to do by typing a minus sign into a list. The upper bound is a sanity
    -- rail, not a policy: 1000% is far past any real markup and still catches a fat finger that meant
    -- 12 and typed 1200.
    ADD CONSTRAINT products_cross_markup_range CHECK (cross_markup_bps BETWEEN 0 AND 100000);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE products
    DROP CONSTRAINT products_cross_markup_range,
    DROP COLUMN cross_markup_bps;
-- +goose StatementEnd
