-- +goose Up
-- THE FEE PAID AT THE DOOR (#155, owner).
--
-- `shipping_cost` is the freight the REQUESTING team agreed when it raised the request. The COD fee is
-- the courier's charge collected on delivery, which the requesting team cannot know in advance and the
-- WAREHOUSE is the one who pays — so it is entered at acceptance, by the side that handed over the
-- money, and lives beside the freight it belongs with.
--
-- Both feed the same calculation: getting the goods here is part of what they cost (#155), so the two
-- are summed and spread across the units that actually arrived sellable.
ALTER TABLE restock_requests
    ADD COLUMN cod_shipping_fee BIGINT NOT NULL DEFAULT 0 CHECK (cod_shipping_fee >= 0);

-- +goose Down
ALTER TABLE restock_requests DROP COLUMN cod_shipping_fee;
