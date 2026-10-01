-- +goose Up
-- THE CATALOGUE OWNER'S LEDGER (#232) — the same events as `stock_movements`, projected into the
-- lens of the team that owns the goods.
--
-- ── Why a second table and not a query over the first ────────────────────────────────────────────
--
-- `stock_movements` answers for a SHELF. Its `balance` is that rack's running total, its `rack_id` is
-- the point of the row, and it has no idea who owns anything — inventory_service is told product ids,
-- never owners. An owner asking "why is my number what it is" has to be answered from the same events
-- seen a different way, and every part of that translation is expensive to redo per request:
--
--   * OWNERSHIP is a three-table climb — batch → restock line → the team that raised the restock.
--     Resolved once, when the movement happens, rather than on every page turn of every product.
--   * A batch-less RECOUNT cannot climb it at all (it names no batch), so it needs a second rule
--     entirely: it belongs to the team that owns stock of that product in that building.
--   * A shelf-to-shelf MOVE is a real event that changes NOTHING the owner holds. It is dropped here,
--     which also keeps the running balance below honest — projecting one leg of a move and not the
--     other would corrupt every figure after it.
--
-- ── What is deliberately NOT here: a balance column ──────────────────────────────────────────────
--
-- The owner's on-hand after each event is a running SUM over these rows, computed at read time by a
-- window function. Stored, it would be a number maintained by two writers on different shelves of the
-- same product with nothing serialising them — two concurrent receives would each read the same
-- "previous" balance and write the same "after". Derived, it cannot drift from the rows it is made
-- of, and a rebuilt projection produces identical figures.
--
-- ── This is a PROJECTION, and it is meant to move ────────────────────────────────────────────────
--
-- Today `appendMovement` writes both tables in one transaction. Later this becomes an event consumer
-- (owner) — the rows and the read shape do not change when it does, which is the point of putting the
-- owner's lens in its own table now rather than fusing it into the ledger.
CREATE TABLE stock_owner_movements (
    id            BIGSERIAL PRIMARY KEY,

    -- The ledger row this projects, so the two can always be reconciled and a rebuild is idempotent.
    movement_id   BIGINT      NOT NULL REFERENCES stock_movements (id) ON DELETE CASCADE,

    -- WHOSE. An opaque team_service id, like every cross-service id here — derived from the restock
    -- the stock arrived on, never supplied by a caller.
    owner_team_id BIGINT      NOT NULL CHECK (owner_team_id > 0),

    warehouse_id  BIGINT      NOT NULL,
    product_id    BIGINT      NOT NULL,

    -- NULL for a batch-less event (a shelf recount). Not a FK cascade target by accident: a batch is
    -- never deleted, but if one ever were, its ledger rows going with it is the correct outcome.
    batch_id      BIGINT REFERENCES stock_batches (id) ON DELETE CASCADE,

    kind          INT         NOT NULL,
    delta         BIGINT      NOT NULL,

    reason        TEXT        NOT NULL DEFAULT '',
    ref           TEXT        NOT NULL DEFAULT '',
    actor_user_id BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),

    -- The EVENT's time, copied from the movement — not the projection's insert time. The backfill
    -- below writes rows for things that happened months ago, and the history is read in event order.
    created_at    TIMESTAMPTZ NOT NULL,

    -- One row per movement per owner. A pair rather than movement_id alone because a batch-less
    -- recount resolves its owner from the product's batches, and nothing in the schema forbids two
    -- teams holding batches of one product in one building.
    UNIQUE (movement_id, owner_team_id)
);

-- The only read there is: one owner's ledger for one product, newest first, optionally narrowed to one
-- building. warehouse_id sits before id so the lens is an index seek rather than a filter, and the
-- (owner, product) prefix still serves the every-warehouse case.
CREATE INDEX idx_stock_owner_movements_read
    ON stock_owner_movements (owner_team_id, product_id, warehouse_id, id DESC);

-- BACKFILL. Without it the tab opens empty on every product that already has a history, which reads
-- as "nothing ever happened" — the exact lie the tab exists to prevent.
--
-- Two passes because the two ownership rules are genuinely different, not two branches of one.

-- 1. BATCH-BORNE events: ownership climbs the restock chain from the batch the event names.
INSERT INTO stock_owner_movements
    (movement_id, owner_team_id, warehouse_id, product_id, batch_id, kind, delta, reason, ref,
     actor_user_id, created_at)
SELECT m.id, r.requesting_team_id, m.warehouse_id, m.product_id, m.batch_id, m.kind, m.delta,
       m.reason, m.ref, m.actor_user_id, m.created_at
FROM stock_movements m
JOIN stock_batches b ON b.id = m.batch_id
JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
JOIN restock_requests r ON r.id = ri.restock_request_id
WHERE m.batch_id IS NOT NULL
  -- 6 = MOVEMENT_KIND_MOVE: shelf-to-shelf inside one building. See the header.
  AND m.kind <> 6
ON CONFLICT (movement_id, owner_team_id) DO NOTHING;

-- 2. BATCH-LESS events (a shelf recount): they name no batch, so ownership is resolved from the
--    product instead — whoever owns stock of it in that building. A movement for a product no team
--    has ever restocked there projects to nobody, which is correct: there is no owner to tell.
INSERT INTO stock_owner_movements
    (movement_id, owner_team_id, warehouse_id, product_id, batch_id, kind, delta, reason, ref,
     actor_user_id, created_at)
SELECT m.id, o.owner_team_id, m.warehouse_id, m.product_id, NULL, m.kind, m.delta,
       m.reason, m.ref, m.actor_user_id, m.created_at
FROM stock_movements m
JOIN LATERAL (
    SELECT DISTINCT r.requesting_team_id AS owner_team_id
    FROM stock_batches b
    JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
    JOIN restock_requests r ON r.id = ri.restock_request_id
    WHERE b.product_id = m.product_id
      AND b.warehouse_id = m.warehouse_id
) o ON TRUE
WHERE m.batch_id IS NULL
  AND m.kind <> 6
ON CONFLICT (movement_id, owner_team_id) DO NOTHING;

-- +goose Down
DROP INDEX IF EXISTS idx_stock_owner_movements_read;

DROP TABLE IF EXISTS stock_owner_movements;
