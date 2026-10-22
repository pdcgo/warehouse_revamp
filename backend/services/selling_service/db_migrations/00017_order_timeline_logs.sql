-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S TIMELINE IS order_timeline_logs (order-timeline-logs-replaces-order-events, owner 2026-10-15): "simple, drop
-- order_events and create new order_timeline_logs". The table is the owner's own (order/context.md §Table That Must
-- Have): one row is a STATUS CHANGE, or a NOTE written while working the order — no goods on Rak A — with who wrote it and
-- from which side.
--
-- order_events is DROPPED, NOT MIGRATED: the owner's decision carries nothing over. Its 00015 `note` column goes with it.
CREATE TABLE order_timeline_logs (
    id         BIGSERIAL   PRIMARY KEY,
    order_id   BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    -- The status moved INTO, as OrderStatus text. '' = a note only.
    status     TEXT        NOT NULL DEFAULT '',
    note       TEXT        NOT NULL DEFAULT '',
    -- 'warehouse' or 'selling'. A keyword in SQL, so it is quoted wherever it is written by hand.
    "from"     TEXT        NOT NULL,
    -- Opaque user_service id, no FK. 0 = not recorded.
    actor_id   BIGINT      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A row says something: it is a move, or a note, or both.
    CONSTRAINT order_timeline_logs_says_something CHECK (status <> '' OR note <> '')
);

-- The timeline reads one order's rows oldest first: an index scan, never a sort.
CREATE INDEX order_timeline_logs_order_idx ON order_timeline_logs (order_id, created_at, id);

DROP TABLE order_events;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- order_events comes back EMPTY (as 00011 + 00015 left its shape) — what the Up dropped is not recoverable, and the
-- timeline rows written since are not carried back either.
CREATE TABLE order_events (
    id            BIGSERIAL   PRIMARY KEY,
    order_id      BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL,
    actor_user_id BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    at            TIMESTAMPTZ NOT NULL,
    note          TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order ON order_events (order_id, at, id);

DROP TABLE order_timeline_logs;
-- +goose StatementEnd
