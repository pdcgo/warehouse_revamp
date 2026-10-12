-- +goose Up
-- +goose StatementBegin
-- THE SHOP'S PRIMARY CS (the-primary-cs-is-a-flag-on-a-grant) — a flag on ONE of its grants.
--
-- On the grant, not on the shop, so a primary can never be someone without access: the flag goes with
-- the row when the grant is removed, and the shop is left with none until someone is made primary.
ALTER TABLE shop_users
    ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one per shop. Partial, so every non-primary grant is free of it.
CREATE UNIQUE INDEX shop_users_one_primary_idx ON shop_users (shop_id) WHERE is_primary;

-- A shop already granted gets a primary on day one: its EARLIEST grant — what "the first user granted
-- becomes the primary" would have given it, had the rule existed then.
UPDATE shop_users su
SET is_primary = TRUE
FROM (
    SELECT DISTINCT ON (shop_id) id
    FROM shop_users
    ORDER BY shop_id, created_at, id
) first_grant
WHERE su.id = first_grant.id;

-- THE STATEMENT LOOKUP (OrderByExternalRefs) — a statement's refs resolved to the team's orders in one
-- call. Partial: '' is an order with no marketplace ref, which nothing ever looks up.
--
-- ⚠ NOT UNIQUE. an-order-is-unique-by-shop-and-marketplace-ref decides the rule is checked IN CODE on
-- create, cancelled orders excluded — which a plain unique index cannot express — and that check is
-- the order context's to build. This index only makes the lookup cheap, and the lookup answers every
-- order a ref finds, so a duplicate is visible rather than hidden.
CREATE INDEX orders_team_external_ref_idx ON orders (team_id, order_external_ref_id)
    WHERE order_external_ref_id <> '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX orders_team_external_ref_idx;
DROP INDEX shop_users_one_primary_idx;
ALTER TABLE shop_users
    DROP COLUMN is_primary;
-- +goose StatementEnd
