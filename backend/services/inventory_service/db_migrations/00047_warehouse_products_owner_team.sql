-- +goose Up
-- +goose StatementBegin

-- THE LINK NAMES ITS OWNER TEAM (the-warehouse-link-names-its-owner-team, docs/business/inventory/context_decision.md).
-- `warehouse_products` gains `owner_team_id` — the team that OWNS the product, its selling team — the name the stock
-- design and the transaction line use. `UNIQUE (warehouse_id, product_id)` stays: a product has one owner, so the column
-- never splits a row. No index: nothing reads the column yet.
--
-- THE FILL. Existing rows are filled from inventory's own tables (revamp-has-no-real-orders-yet: only dev rows, filled so
-- the migration applies cleanly). The owner is the PRODUCT's, not the warehouse's, so a row is filled from any of
-- inventory's rows naming that product, in any warehouse:
--   * a batch's `team_id` — its owner, written at mint and never changed (a-batch-carries-its-owner);
--   * a restock's `team_id`, for a product on its lines — a restock carries only the team's own products
--     (a-restock-carries-only-the-teams-own-products); the writer that linked most rows;
--   * a transfer's `team_id`, for a product on its lines — a transfer carries only the team's own products;
--   * a stock line's `product_team_id` — the product's owner on every item (an-item-carries-its-owning-team).
-- Together they must name exactly ONE team; that team is the row's owner.
--
-- ⚠ THE GUARD. A row that cannot be filled with one owner REFUSES the migration — nothing changed, the version not
-- recorded — and the message lists the rows:
--   * a product two teams' rows name as theirs — a product has one owner, so taking either would be a guess;
--   * a product no row names at all (a link left by a restock line later edited away, or by a transfer whose create then
--     failed, on a product inventory holds nothing else of) — inventing an owner or deleting the link (ProductHasHistory
--     reads it) are both a change of data nobody asked for.
-- Fix those rows by hand on that (local) database, then migrate again.
CREATE TEMP TABLE warehouse_product_owners ON COMMIT DROP AS
SELECT wp.id,
       wp.warehouse_id,
       wp.product_id,
       COUNT(DISTINCT named.team_id)                     AS teams,
       MIN(named.team_id)                                AS team_id,
       string_agg(DISTINCT named.team_id::text, ' and ') AS team_names
FROM warehouse_products wp
LEFT JOIN (
    SELECT b.product_id, b.team_id
    FROM batches b
    UNION
    SELECT i.product_id, r.team_id
    FROM restock_items i
    JOIN restocks r ON r.id = i.restock_id
    UNION
    SELECT i.product_id, t.team_id
    FROM warehouse_transfer_items i
    JOIN warehouse_transfers t ON t.id = i.transfer_id
    UNION
    SELECT i.product_id, i.product_team_id
    FROM inventory_transaction_items i
) named ON named.product_id = wp.product_id AND named.team_id > 0
GROUP BY wp.id, wp.warehouse_id, wp.product_id;

DO $guard$
DECLARE
    two_owners TEXT;
    no_owner   TEXT;
BEGIN
    SELECT string_agg(format('product %s at warehouse %s (teams %s)', product_id, warehouse_id, team_names), ', '
               ORDER BY product_id, warehouse_id) FILTER (WHERE teams > 1),
           string_agg(format('product %s at warehouse %s', product_id, warehouse_id), ', '
               ORDER BY product_id, warehouse_id) FILTER (WHERE teams = 0)
    INTO two_owners, no_owner
    FROM warehouse_product_owners;

    IF two_owners IS NOT NULL OR no_owner IS NOT NULL THEN
        RAISE EXCEPTION 'warehouse_products: % — a product has one owner '
            '(the-warehouse-link-names-its-owner-team); fix these links on this database, then migrate again',
            concat_ws('; ',
                'named by two teams: ' || two_owners,
                'no inventory row names an owner: ' || no_owner);
    END IF;
END
$guard$;

ALTER TABLE warehouse_products ADD COLUMN owner_team_id BIGINT;

UPDATE warehouse_products wp
SET owner_team_id = o.team_id
FROM warehouse_product_owners o
WHERE o.id = wp.id;

-- Every row is filled (the guard); from here on every writer names the owner.
ALTER TABLE warehouse_products
    ALTER COLUMN owner_team_id SET NOT NULL,
    ADD CONSTRAINT warehouse_products_owner_team_id_check CHECK (owner_team_id > 0);

DROP TABLE warehouse_product_owners;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- The column goes, its check with it; the links stay, exactly as 00011 made them.
ALTER TABLE warehouse_products DROP COLUMN owner_team_id;

-- +goose StatementEnd
