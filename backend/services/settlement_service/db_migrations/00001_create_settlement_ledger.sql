-- +goose Up
-- +goose StatementBegin
-- THE LEDGER OF WHAT TEAMS OWE EACH OTHER (#183, plans/settlement_service/brainstorming.md §4).
--
-- Two tables, and the relationship between them is the whole design: `settlement_entries` is the
-- TRUTH — immutable, append-only — and `settlement_balances` is a PROJECTION of it. Every balance
-- must be recomputable from the entries alone, or the ledger cannot be audited.
--
-- Money is BIGINT, whole rupiah, as everywhere else in this system. Float cannot represent 0.1
-- exactly, so sums drift and equality decays into "within epsilon" — at which point "are we square?"
-- has no yes/no answer at all.
CREATE TABLE settlement_entries (
    id              BIGSERIAL   PRIMARY KEY,

    -- ONE LEG. Every posting writes two rows — one from each side — in one transaction, so posting
    -- half a movement is impossible. `team_id` is whose books this row is in.
    team_id         BIGINT      NOT NULL,
    counterparty_id BIGINT      NOT NULL,

    -- ⚠ ONE SIGN CONVENTION, STATED ONCE: from team_id's point of view, a RECEIVABLE is POSITIVE and
    -- a PAYABLE is NEGATIVE. The two legs of a movement are exact negatives of each other, which is
    -- also what makes "the whole ledger sums to zero" a check anybody can run.
    amount          BIGINT      NOT NULL,

    -- WHAT CAUSED IT — a typed pair, never a free-text note. "Why do I owe this?" is the first
    -- question anyone asks a balance, and a note cannot be joined, filtered or counted. source_id is
    -- an opaque id in another service (a restock request, an order, a payment); no FK, and none is
    -- possible — those tables belong to other services.
    --
    -- Stored as TEXT with no CHECK IN-list, exactly like orders.status: the mapper and the proto
    -- guard the value, and an IN-list is one more place to drift when the enum grows.
    source_type     TEXT        NOT NULL,
    source_id       BIGINT      NOT NULL,

    -- ⚠ WHETHER THIS LEG UNDOES AN EARLIER ONE, and it is part of the IDEMPOTENCY KEY rather than a
    -- display flag. A compensating entry shares source_type, source_id and counterparty with the
    -- entry it reverses — reversal is never a delete — so without this column the unique index below
    -- would treat a reversal as a duplicate of the thing it reverses and silently swallow it.
    reversal        BOOLEAN     NOT NULL DEFAULT FALSE,

    -- BOTH LEGS OF ONE MOVEMENT SHARE THIS. Without it, "show me both sides of this posting" is
    -- answerable only by matching amount, opposite sign and a near timestamp — a heuristic that
    -- fails exactly when two similar postings land together.
    group_id        BIGINT      NOT NULL,

    -- The balance after this entry, on this side. A convenience for the history screen and NOT a
    -- second source of truth: it is derived, and the entries remain what it is derived from.
    balance_after   BIGINT      NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A team cannot owe itself. This would only ever arise from a bug upstream, and a ledger is the
    -- wrong place to discover one quietly.
    CONSTRAINT settlement_entries_sides_differ CHECK (team_id <> counterparty_id)
);

-- ⚠ THE IDEMPOTENCY KEY, and it is load-bearing rather than defensive.
--
-- The order fees arrive on Pub/Sub, which delivers AT LEAST ONCE — a redelivered order is normal, not
-- an error. The handler can only safely ACK a duplicate if the database is what makes the duplicate
-- harmless; without this index the alternative is NACKing, which makes Pub/Sub redeliver a message
-- that can never succeed. A poison loop built entirely out of correct behaviour.
--
-- team_id is in the key because a movement writes both legs, and they differ only by which side they
-- are on: (selling, warehouse) and (warehouse, selling) are two rows, not a duplicate.
--
-- counterparty is in the key because ONE ORDER POSTS SEVERAL ENTRIES — a handling fee to the
-- warehouse plus one product fee per owning team — so `source_id` alone is not enough.
CREATE UNIQUE INDEX settlement_entries_source_idx
    ON settlement_entries (team_id, counterparty_id, source_type, source_id, reversal);

-- The history screen: one counterparty's entries, newest first.
CREATE INDEX settlement_entries_pair_idx ON settlement_entries (team_id, counterparty_id, id DESC);

-- Both legs of one movement come from here, so the two rows agree without either having to be
-- written first. A sequence rather than "the first leg's id" because that would make one leg
-- special, and the two legs are peers.
CREATE SEQUENCE settlement_group_seq;

-- The running total per pair — a PROJECTION of the entries above, kept because "what do we owe each
-- other" is asked far more often than it changes, and summing a growing log on every read is the
-- slow query this table exists to avoid.
CREATE TABLE settlement_balances (
    id                  BIGSERIAL   PRIMARY KEY,
    team_id             BIGINT      NOT NULL,
    counterparty_id     BIGINT      NOT NULL,

    -- Same sign convention as the entries. Positive = they owe you.
    balance             BIGINT      NOT NULL DEFAULT 0,

    -- WHEN THE CURRENT RUN OF DEBT BEGAN, or NULL when the pair is square.
    --
    -- Ageing is the point of the position screen — "Rp 2.4m, oldest unsettled 47 days" is actionable
    -- in a way a balance alone is not. This is the age of the current NON-ZERO RUN: it is set when
    -- the balance leaves zero and cleared when it returns, so paying in full resets the clock and a
    -- partial payment does not.
    --
    -- A per-entry FIFO age would be truer under partial payments, and it needs an allocation model —
    -- which payment settled which entry — that nothing here has. See §5.3 for the trade.
    oldest_unsettled_at TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⚠ IN THE FIRST MIGRATION, ON PURPOSE. Lock-then-read does not protect a row that does not exist
-- yet: two concurrent first-postings for a new pair both find nothing, both insert, and one update is
-- lost. Only a database constraint prevents that, and adding it later means adding it after the day
-- it was first needed.
CREATE UNIQUE INDEX settlement_balances_pair_idx
    ON settlement_balances (team_id, counterparty_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE settlement_balances;
DROP SEQUENCE settlement_group_seq;
DROP TABLE settlement_entries;
-- +goose StatementEnd
