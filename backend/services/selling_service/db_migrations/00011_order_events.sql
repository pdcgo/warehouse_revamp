-- +goose Up
-- THE ORDER'S OWN HISTORY — one append-only row per thing that happened to it.
--
-- The order detail grew a Timeline tab, and an order could not answer it: the row carries `status`
-- (where it is NOW), `created_at` and `updated_at`, and nothing else. A shipped order therefore knew
-- the day it was placed, the day it last changed, and nothing whatsoever about the four steps in
-- between — nor who took any of them, though every one of those steps is a person doing a job.
--
-- Why a table and not six column pairs (confirmed_at/by, picked_at/by, …). Twelve columns would
-- answer today's six statuses and nothing else: the seventh thing worth recording — a note edited, a
-- receipt attached, a courier corrected — costs another migration, another pair, and another branch on
-- the screen that assembles them. A row costs a constant. This is the same conclusion the restock
-- timeline reached in inventory_service 00019, for the same reason, and the two now read alike.
--
-- APPEND ONLY. Nothing here is ever updated or deleted: an event is a claim that something happened at
-- a moment, and a mutable history is not a history. No UNIQUE on (order_id, kind) either — the
-- lifecycle is what keeps CONFIRMED singular (only a placed order can be confirmed), exactly as it is
-- what keeps `status` honest (#80), and a future kind that legitimately repeats must not need a
-- schema change to be allowed.
CREATE TABLE order_events (
    id            BIGSERIAL PRIMARY KEY,
    order_id      BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

    -- Stored as TEXT and mapped in the handler layer, like `status` beside it — no DB CHECK IN-list
    -- (#80), so adding a kind is a constant rather than a migration.
    kind          TEXT        NOT NULL,

    -- WHO, as an opaque user_service id (no FK across services, HARD RULE 3). 0 = not recorded: true
    -- of every backfilled row below, and of anything a system process ever does.
    actor_user_id BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),

    -- WHEN it happened, which is not when the row was written — the backfill below writes events for
    -- orders placed months ago. The timeline orders by this.
    at            TIMESTAMPTZ NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read there is: one order's history, oldest first. `at` is in the index because the
-- timeline's order is the EVENT order, never the insert order — the backfill inserts every 'placed'
-- row before any of the later ones.
CREATE INDEX idx_order_events_order
    ON order_events (order_id, at, id);

-- BACKFILL — from the two moments an order row actually records.
--
-- Without it every order predating this migration would show an EMPTY timeline, and the screen reads
-- events: a record of nothing is worse than a short record, because it reads as a bug rather than as
-- history that was never kept.
--
-- ⚠ TWO EVENTS AT MOST, and that is the honest ceiling. `created_at` is when it was placed;
-- `updated_at` is when it last moved, which for a non-placed order is when it reached the status it is
-- in now. An order sitting in SHIPPED went through CONFIRMED, PICKING and PACKED — but the row never
-- wrote down when, so those steps are NOT invented here. A fabricated "picked at some plausible time"
-- is indistinguishable on the screen from one that was really recorded, which makes every step
-- untrustworthy rather than just the missing ones.
--
-- No actor on any of it: the orders table has never had a created_by, so nothing knows who placed or
-- confirmed anything before today. 0 carries "not recorded" forward, and the timeline renders a step
-- with a date and no person rather than putting somebody's name against work they may not have done.
INSERT INTO order_events (order_id, kind, actor_user_id, at)
SELECT id, 'placed', 0, created_at
FROM orders;

INSERT INTO order_events (order_id, kind, actor_user_id, at)
SELECT id, status, 0, updated_at
FROM orders
WHERE status <> 'placed';

-- +goose Down
DROP INDEX IF EXISTS idx_order_events_order;

DROP TABLE IF EXISTS order_events;
