-- +goose Up
-- +goose StatementBegin
-- What each order was EXPECTED to make, frozen when it was placed (#75).
--
-- A stored record rather than a calculation, which is the owner's call against a cheaper option: #74
-- already froze total, cogs and shipping onto the order, so a screen could compute the margin with no
-- table at all. What this buys is a HOME FOR #76 — settlement compares expected against what the payout
-- actually was, and "actual" has nowhere to live without a row beside it.
--
-- team_id and order_id are OPAQUE selling_service ids — no FK (HARD RULE 3).
CREATE TABLE order_revenues (
    id              BIGSERIAL   PRIMARY KEY,

    team_id         BIGINT      NOT NULL,
    order_id        BIGINT      NOT NULL,

    -- Whole rupiah, COPIED from the order rather than referenced: this row must still read correctly
    -- if the order is later edited or #74's cost rule changes. A record that followed the order would
    -- stop being a record of what was expected AT THE TIME.
    revenue         BIGINT      NOT NULL,
    cogs            BIGINT      NOT NULL,
    shipping_cost   BIGINT      NOT NULL,

    -- revenue - cogs - shipping_cost, computed once. Stored rather than derived because #76
    -- reconciles against it, and a number you reconcile against must be the one you actually promised.
    expected_margin BIGINT      NOT NULL,

    -- Whether `cogs` is real or a stand-in for "unknown" (#74). 0 is a legitimate cost as well as the
    -- unknown marker, so without this the two cannot be told apart — and a margin over an unknown cost
    -- reads as pure profit.
    cost_known      BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One record per order. Recording twice is a caller bug, and a duplicate would double every total
-- computed from this table — the kind of error that looks like good news.
CREATE UNIQUE INDEX order_revenues_order_unique ON order_revenues (order_id);
-- "What did this team make" — the list, and every report built on it.
CREATE INDEX order_revenues_team_idx ON order_revenues (team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_revenues;
-- +goose StatementEnd
