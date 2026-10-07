-- +goose Up
-- THE RESTOCK'S OWN HISTORY (owner) — one append-only row per thing that happened to it.
--
-- Why a table and not two more columns. Editing a restock had to appear on the timeline, and the
-- cheap version of that is `updated_at` + `updated_by`: one migration, and a step reading "last
-- edited". But a restock is edited repeatedly while it is still pending — a quantity corrected, a
-- courier added, a line dropped — and two columns can only ever remember the MOST RECENT one. A row
-- edited five times would read identically to one edited once, which is the failure the column pair
-- cannot be fixed out of.
--
-- So the events are ROWS, and the timeline reads THIS instead of assembling itself from three
-- separate column pairs. One source, one order, and a new kind of event costs a row rather than a
-- schema change and another branch on the screen.
--
-- APPEND ONLY. Nothing here is ever updated or deleted: an event is a claim that something happened
-- at a moment, and a mutable history is not a history. There is deliberately no UNIQUE constraint on
-- (restock_request_id, kind) — a restock legitimately has MANY edits, and CREATED/ACCEPTED/CANCELLED
-- are kept unique by the lifecycle (a request can only be accepted from pending) rather than by the
-- schema, exactly as `status` is (#80).
CREATE TABLE restock_request_events (
    id                 BIGSERIAL PRIMARY KEY,
    restock_request_id BIGINT      NOT NULL REFERENCES restock_requests (id) ON DELETE CASCADE,

    -- Stored as TEXT and mapped in the handler layer, like `status` and `payment_type` — no DB
    -- CHECK IN-list (#80), because adding a kind must not be a migration.
    kind               TEXT        NOT NULL,

    -- WHO, as an opaque user_service id (no FK, like every cross-service id here). 0 = not recorded:
    -- true of a backfilled row whose actor the old columns never captured.
    actor_user_id      BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),

    -- WHEN it happened. Its own column rather than leaning on created_at: the backfill below writes
    -- events for things that happened months ago, and a row's insert time is not its event time.
    at                 TIMESTAMPTZ NOT NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read there is: one request's history, oldest first. `at` is in the index because the
-- timeline's order is the event order, never the insert order — a backfilled ACCEPTED event is
-- inserted after the CREATED one but may predate it in wall-clock terms if the backfill runs oddly.
CREATE INDEX idx_restock_request_events_request
    ON restock_request_events (restock_request_id, at, id);

-- WHO CALLED IT OFF (owner). `created_by_user_id` and `accepted_by_user_id` landed in 00018 and this
-- one was missed, so the cancelled step on the timeline could name a date and no person — while every
-- other step named somebody. Filled from the caller's identity, exactly as the other two are.
ALTER TABLE restock_requests
    ADD COLUMN cancelled_by_user_id BIGINT NOT NULL DEFAULT 0 CHECK (cancelled_by_user_id >= 0);

-- BACKFILL, from the columns that already record these three facts.
--
-- Without it every restock predating this migration would show an EMPTY timeline — the screen reads
-- events now, so a request with none would look like a record of nothing rather than a record whose
-- history was kept in columns. The columns stay (the list filters and columns read them); the events
-- are how the history is read in order.
--
-- `actor_user_id` comes across as-is, INCLUDING 0. A row raised before 00018 does not say who raised
-- it, and 0 carries that "not recorded" forward honestly — inventing an id here would put a real
-- person's name against work they may not have done, which is the reason 00018 refused to backfill in
-- the first place.
--
-- EDITED events cannot be backfilled at all and are not faked: nothing in the schema ever recorded an
-- edit, so the history of an old restock legitimately begins with what is known.
INSERT INTO restock_request_events (restock_request_id, kind, actor_user_id, at)
SELECT id, 'created', created_by_user_id, created_at
FROM restock_requests;

INSERT INTO restock_request_events (restock_request_id, kind, actor_user_id, at)
SELECT id, 'accepted', accepted_by_user_id, accepted_at
FROM restock_requests
WHERE accepted_at IS NOT NULL;

-- No actor: cancelled_by_user_id is added by this very migration, so every existing cancellation has
-- 0 in it. The event says when, and says nothing about who — which is what the record knows.
INSERT INTO restock_request_events (restock_request_id, kind, actor_user_id, at)
SELECT id, 'cancelled', 0, cancelled_at
FROM restock_requests
WHERE cancelled_at IS NOT NULL;

-- +goose Down
ALTER TABLE restock_requests
    DROP COLUMN cancelled_by_user_id;

DROP INDEX IF EXISTS idx_restock_request_events_request;

DROP TABLE IF EXISTS restock_request_events;
