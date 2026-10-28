-- +goose Up
-- WHAT A RETURNED BORROWED PRODUCT COMES BACK AS (the-return-map-is-selling-services-and-read-by-ids) — the owner's
-- order_return.md §Table Must Have item 2.
--
-- A selling team that sells another team's product maps it, once, to one of its OWN products; a return of it lands as
-- that product (a-return-never-clones-a-product). The map is made on the order form at the confirmed pick
-- (the-map-is-written-when-it-is-picked), and order create refuses a borrowed line without one
-- (a-borrowed-line-needs-its-map-at-create). An own line never reads it (an-own-line-never-touches-the-map).
--
-- UNIQUE ON THE SOURCE, not the pair (the-map-is-unique-on-its-source): one row per team per borrowed product. Two own
-- products for one borrowed product would be two stock piles for one physical thing. It is also what makes the write
-- one INSERT … ON CONFLICT DO NOTHING, so two people mapping the same product at the same second leave ONE row, and
-- both are handed it back.
--
-- WRITTEN ONCE (a-return-map-is-written-once): nothing updates a row — units already on a shelf went there under it.
-- `updated_at` is kept for uniformity and mirrors `created_at`.
--
-- Both product ids are opaque product_service ids — no FK crosses a service boundary. Ownership (the borrowed one is
-- another team's, the own one is this team's) is checked by the write, against product_service, not here. No
-- `warehouse_id`: a map is a catalogue fact, not a location.
CREATE TABLE product_return_maps (
    id                BIGSERIAL PRIMARY KEY,
    team_id           BIGINT      NOT NULL,
    shared_product_id BIGINT      NOT NULL CHECK (shared_product_id > 0),
    own_product_id    BIGINT      NOT NULL CHECK (own_product_id > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A product is never its own return: the write refuses it already, as "the borrowed product is your own".
    CHECK (shared_product_id <> own_product_id)
);

-- One per team per borrowed product — the map's key, the write's ON CONFLICT arbiter, and the index both reads use
-- (`team_id = ? AND shared_product_id IN (…)`: ByIds, and order create's check).
CREATE UNIQUE INDEX product_return_maps_team_shared_idx ON product_return_maps (team_id, shared_product_id);

-- +goose Down
DROP TABLE product_return_maps;
