-- +goose Up
-- +goose StatementBegin
ALTER TABLE products
    -- LOCKED: may another team put this product on ITS order?
    --
    -- FALSE (the default) = yes, it is available for cross selling, which is how every product has
    -- behaved until now — ProductDiscover has always shown every team's catalogue to every selling
    -- team. Keeping the default at FALSE means this column changes nothing on its own; locking is a
    -- decision somebody makes per product.
    --
    -- TRUE = ours only. The product stops appearing in cross-team discovery, so nobody can build an
    -- order around stock we are not offering.
    ADD COLUMN cross_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Discovery reads the OTHER teams' catalogues and now has to skip locked rows, so the partial index
-- carries the same predicates the query does.
CREATE INDEX products_discoverable_idx ON products (id) WHERE deleted = FALSE AND cross_locked = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX products_discoverable_idx;

ALTER TABLE products
    DROP COLUMN cross_locked;
-- +goose StatementEnd
