-- +goose Up
-- +goose StatementBegin
-- THE STOCK COUNT (docs/business/inventory/opname.md, accepted 2026-11-02 — the-count-prototype-is-accepted): a session
-- snapshots the shelf book, its open rows ARE the lock, staff count blind and write each difference as a draft with its
-- reason, and finalize posts the drafts into the stock-problem register and the ledgers. The seven tables are the
-- owner's, in the order opname.md lists them; a column the owner's list does not carry says so where it is declared.
--
-- Money is DOUBLE PRECISION (stock-money-is-float64-compared-at-4-digits). Every *_id but the in-service ones is another
-- service's: no FK.

-- 1. A SESSION — one count of one warehouse (an-opname-is-a-locked-session). `plan` is the KIND of plan; its target was
--    only a filter on the snapshot and is not kept (the-plan-target-is-only-a-filter). Finalizing IS the agreement — no
--    override flag (finalizing-is-the-agreement).
CREATE TABLE opname_sessions (
    id              BIGSERIAL PRIMARY KEY,
    warehouse_id    BIGINT      NOT NULL CHECK (warehouse_id > 0),
    status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finish', 'cancel')),
    plan            TEXT        NOT NULL CHECK (plan IN ('all', 'team', 'product', 'placement')),
    created_by_id   BIGINT      NOT NULL DEFAULT 0 CHECK (created_by_id >= 0),
    finalized_by_id BIGINT CHECK (finalized_by_id > 0),
    finalized_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A finished session names who finalized it and when; no other status does.
    CONSTRAINT opname_sessions_finalized_when_finished CHECK (
        (status = 'finish') = (finalized_by_id IS NOT NULL AND finalized_at IS NOT NULL))
);

-- ONE ACTIVE COUNT PER WAREHOUSE (one-active-count-per-warehouse), by the database: a second create waits on the first
-- and then fails here.
CREATE UNIQUE INDEX opname_sessions_one_active ON opname_sessions (warehouse_id) WHERE status = 'active';
-- The session list, newest first.
CREATE INDEX opname_sessions_list_idx ON opname_sessions (warehouse_id, id DESC);

-- 2. A SNAPSHOT ROW — one product on one rack in one session (a-snapshot-row-per-product-on-a-rack), copied from
--    `product_placements` (a-snapshot-is-made-from-product-placements). Its count is ONE column: the blind count, or the
--    one recount that replaced it (a-row-keeps-only-its-latest-count) — NULL until counted, which is what "revealed"
--    reads. The OPEN row is the lock (the-lock-is-the-open-snapshot-row): `released_at` is set at finalize or cancel.
--
--    Beyond the owner's list, each for a screen the accepted contract draws:
--      recounted     the one recount is used — a third count is refused (OpnameRow.recounted)
--      found_here    added by a counter as found on this rack (a-counter-may-add-a-product-found-here; OpnameRow.found_here)
--      product_code, product_name   snapshots taken when the row is made, as a restock line's are — the watch page
--                    searches them, and a product's catalogue lives in another service
CREATE TABLE opname_session_snapshots (
    id                    BIGSERIAL PRIMARY KEY,
    warehouse_id          BIGINT      NOT NULL CHECK (warehouse_id > 0),
    -- The product's owner — the shelf row's team.
    team_id               BIGINT      NOT NULL CHECK (team_id > 0),
    product_id            BIGINT      NOT NULL CHECK (product_id > 0),
    placement_id          BIGINT      NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
    opname_session_id     BIGINT      NOT NULL REFERENCES opname_sessions (id) ON DELETE RESTRICT,
    status                TEXT        NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'counted')),
    -- The book at the snapshot (expected-is-the-book-figure).
    system_stock_count    BIGINT      NOT NULL CHECK (system_stock_count >= 0),
    recounted_stock_count BIGINT CHECK (recounted_stock_count >= 0),
    recounted             BOOLEAN     NOT NULL DEFAULT FALSE,
    found_here            BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Whoever entered the count that stands (a-snapshot-row-names-its-counter).
    counted_by_id         BIGINT CHECK (counted_by_id > 0),
    product_code          TEXT        NOT NULL DEFAULT '',
    product_name          TEXT        NOT NULL DEFAULT '',
    released_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A counted row has its count; a recount is a count.
    CONSTRAINT opname_session_snapshots_counted_has_count CHECK (status = 'created' OR recounted_stock_count IS NOT NULL),
    CONSTRAINT opname_session_snapshots_recount_is_a_count CHECK (NOT recounted OR recounted_stock_count IS NOT NULL)
);

-- THE LOCK: one open count per product per rack, by the database (the-lock-is-the-open-snapshot-row). Every mutation that
-- moves units reads it after locking its shelf rows.
CREATE UNIQUE INDEX opname_session_snapshots_open_lock ON opname_session_snapshots (product_id, placement_id)
    WHERE released_at IS NULL;
-- A session's rows by rack — the rack list, the count screen, the watch page.
CREATE INDEX opname_session_snapshots_session_idx ON opname_session_snapshots (opname_session_id, placement_id);
-- "Last counted" on a rack, and of a product on a rack, reads finished sessions' rows.
CREATE INDEX opname_session_snapshots_rack_idx ON opname_session_snapshots (placement_id, product_id);

-- 3. A PROBLEM DRAFT — broken or lost on one rack, with its reason (the-difference-is-a-draft-until-finalize,
--    a-draft-names-its-session-and-rack). Lost is the system's number, broken the counter's
--    (a-short-rack-gets-a-lost-draft-from-the-system); the reason is required before the row is marked counted
--    (a-difference-needs-its-reason-on-the-draft), so it is empty only while the row is still being worked.
CREATE TABLE opname_problems_drafts (
    id                  BIGSERIAL PRIMARY KEY,
    warehouse_id        BIGINT      NOT NULL CHECK (warehouse_id > 0),
    team_id             BIGINT      NOT NULL CHECK (team_id > 0),
    product_id          BIGINT      NOT NULL CHECK (product_id > 0),
    placement_id        BIGINT      NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
    opname_session_id   BIGINT      NOT NULL REFERENCES opname_sessions (id) ON DELETE RESTRICT,
    note                TEXT        NOT NULL DEFAULT '',
    problem_type        TEXT        NOT NULL CHECK (problem_type IN ('broken', 'lost')),
    problem_stock_count BIGINT      NOT NULL CHECK (problem_stock_count > 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One broken and one lost per row, at most.
    CONSTRAINT opname_problems_drafts_one_per_type UNIQUE (opname_session_id, product_id, placement_id, problem_type)
);

-- 4. A SURPLUS DRAFT — a rack over, its number the system's, its reason the counter's
--    (a-surplus-draft-is-counted-by-the-system).
CREATE TABLE opname_surplus_drafts (
    id                  BIGSERIAL PRIMARY KEY,
    warehouse_id        BIGINT      NOT NULL CHECK (warehouse_id > 0),
    team_id             BIGINT      NOT NULL CHECK (team_id > 0),
    product_id          BIGINT      NOT NULL CHECK (product_id > 0),
    placement_id        BIGINT      NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
    opname_session_id   BIGINT      NOT NULL REFERENCES opname_sessions (id) ON DELETE RESTRICT,
    note                TEXT        NOT NULL DEFAULT '',
    surplus_stock_count BIGINT      NOT NULL CHECK (surplus_stock_count > 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT opname_surplus_drafts_one_per_row UNIQUE (opname_session_id, product_id, placement_id)
);

-- 5. THE STOCK-PROBLEM REGISTER — a unit broken or lost in the warehouse's custody, per batch, at that batch's price
--    (a-loss-in-custody-is-a-stock-problem, a-shortage-writes-a-row-per-batch). Two doors write it: a count's finalize
--    and a report at the shelf (an-adjustment-writes-the-same-problem-row); which door is whether a session lists the
--    transaction (a-session-lists-its-final-transactions). A lost unit is claimable, a broken one never
--    (a-broken-unit-is-thrown-away); a claim never passes what is claimable (a-claim-records-its-units).
CREATE TABLE warehouse_stock_problems (
    id                    BIGSERIAL PRIMARY KEY,
    warehouse_id          BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id               BIGINT           NOT NULL CHECK (team_id > 0),
    product_id            BIGINT           NOT NULL CHECK (product_id > 0),
    transaction_id        BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    batch_id              BIGINT           NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
    -- Set when every unit of the row came from one rack (a-problem-row-names-its-rack).
    placement_id          BIGINT REFERENCES placements (id) ON DELETE RESTRICT,
    -- "rack code: note", joined by " · " (a-problem-note-names-its-racks); a shelf report's own note.
    note                  TEXT             NOT NULL DEFAULT '',
    problem_type          TEXT             NOT NULL CHECK (problem_type IN ('broken', 'lost')),
    problem_stock_count   BIGINT           NOT NULL CHECK (problem_stock_count > 0),
    price_unit            DOUBLE PRECISION NOT NULL,
    claimable_stock_count BIGINT           NOT NULL,
    claimed_stock_count   BIGINT           NOT NULL DEFAULT 0 CHECK (claimed_stock_count >= 0),
    created_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    -- Lost is claimable for all its units, broken for none.
    CONSTRAINT warehouse_stock_problems_claimable CHECK (
        (problem_type = 'lost' AND claimable_stock_count = problem_stock_count)
        OR (problem_type = 'broken' AND claimable_stock_count = 0)),
    -- Two counts at one second cannot claim one unit twice.
    CONSTRAINT warehouse_stock_problems_claim_cap CHECK (claimed_stock_count <= claimable_stock_count)
);

-- The claim: a team's open losses of a product here, oldest first (a-surplus-claims-the-oldest-loss-first).
CREATE INDEX warehouse_stock_problems_open_idx ON warehouse_stock_problems (warehouse_id, team_id, product_id, created_at, id)
    WHERE problem_type = 'lost' AND claimed_stock_count < claimable_stock_count;
CREATE INDEX warehouse_stock_problems_transaction_idx ON warehouse_stock_problems (transaction_id);

-- 6. A CLAIM — which problem, which transaction, how many units (a-claim-names-its-transaction, a-claim-records-its-units).
--    The problem's claimed_stock_count is the sum of these.
CREATE TABLE problem_claimed_transactions (
    id                  BIGSERIAL PRIMARY KEY,
    warehouse_id        BIGINT      NOT NULL CHECK (warehouse_id > 0),
    problem_id          BIGINT      NOT NULL REFERENCES warehouse_stock_problems (id) ON DELETE RESTRICT,
    transaction_id      BIGINT      NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    claimed_stock_count BIGINT      NOT NULL CHECK (claimed_stock_count > 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT problem_claimed_transactions_once UNIQUE (problem_id, transaction_id)
);

CREATE INDEX problem_claimed_transactions_transaction_idx ON problem_claimed_transactions (transaction_id);

-- 7. WHAT A FINALIZE WROTE — up to three transactions per owning team, problem · found · move
--    (a-session-lists-its-final-transactions). Listed ⇒ the transaction came through a count.
CREATE TABLE opname_session_final_transactions (
    id                BIGSERIAL PRIMARY KEY,
    opname_session_id BIGINT      NOT NULL REFERENCES opname_sessions (id) ON DELETE RESTRICT,
    transaction_id    BIGINT      NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT opname_session_final_transactions_once UNIQUE (transaction_id)
);

CREATE INDEX opname_session_final_transactions_session_idx ON opname_session_final_transactions (opname_session_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE opname_session_final_transactions;
DROP TABLE problem_claimed_transactions;
DROP TABLE warehouse_stock_problems;
DROP TABLE opname_surplus_drafts;
DROP TABLE opname_problems_drafts;
DROP TABLE opname_session_snapshots;
DROP TABLE opname_sessions;
-- +goose StatementEnd
