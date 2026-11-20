-- +goose Up
-- +goose StatementBegin
-- CUSTOM SHIPMENTS — THE LIST'S INDEXES (backlog #88 P2, a-pure-index-is-added-without-asking: each measured in
-- custom_shipment_list_perf_test.go at 70 000 parcels, a busy warehouse shipping 35 000 of them over three years). No
-- query changes; nothing is dropped.
--
-- 1. THE STATUS TABS. The list (CustomShipmentList) opens on one status — the warehouse's queue is its REQUESTED tab — and
--    reads the reader's parcels as `(team_id = X OR warehouse_id = X) AND status = S`, newest first, with a count. On
--    00057's (team_id, id DESC) / (warehouse_id, id DESC) alone the planner seq-scans the whole table for that count; with
--    the status in the key it reads only that tab's entries, whatever the history grows to: the queue 9.3 → 2.0 ms
--    (generic plan 7.6 → 1.8 ms), the picked tab 8.4 → 1.7 ms, a selling team's requested tab 6.9 → 2.5 ms.
CREATE INDEX custom_shipments_team_status_idx      ON custom_shipments (team_id, status, id DESC);
CREATE INDEX custom_shipments_warehouse_status_idx ON custom_shipments (warehouse_id, status, id DESC);

-- 2. THE FREE TEXT over a line's product code or name — `LOWER(code|name) LIKE '%q%'`, which no b-tree serves, so every
--    search read EVERY team's parcel lines, twice a call (count and page): 150–190 ms → 18–37 ms for a term of three
--    characters or more. A shorter term gives a trigram index nothing to look up; the planner keeps the old plan for it
--    (unchanged, ~200 ms). pg_trgm is a TRUSTED extension (no superuser); IF NOT EXISTS — an extension is the database's,
--    and another service may have created it first (selling 00048).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX custom_shipment_items_search_trgm_idx
    ON custom_shipment_items USING gin (LOWER(product_code) gin_trgm_ops, LOWER(name) gin_trgm_ops);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- The extension stays: it is the database's, and another service's index may use it.
DROP INDEX custom_shipment_items_search_trgm_idx;
DROP INDEX custom_shipments_warehouse_status_idx;
DROP INDEX custom_shipments_team_status_idx;
-- +goose StatementEnd
