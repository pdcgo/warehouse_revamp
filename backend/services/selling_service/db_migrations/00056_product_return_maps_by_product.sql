-- Produk Turunan reads a product's return maps with NO team (produk-turunan-is-the-return-map, ProductDerivedList):
-- every team's map FROM it (`shared_product_id`) and the maps landing ON it (`own_product_id`). The unique
-- (team_id, shared_product_id) index cannot seek on either, so both directions walked the table (≈5.5 ms at 50 000
-- maps → ≈0.5 ms with these; the write unchanged within noise — audits/services/selling_service/performances/
-- ProductDerivedList.md). A pure index addition, measured: a-pure-index-is-added-without-asking.

-- +goose Up
CREATE INDEX product_return_maps_shared_idx ON product_return_maps (shared_product_id);
CREATE INDEX product_return_maps_own_idx ON product_return_maps (own_product_id);

-- +goose Down
DROP INDEX product_return_maps_own_idx;
DROP INDEX product_return_maps_shared_idx;
