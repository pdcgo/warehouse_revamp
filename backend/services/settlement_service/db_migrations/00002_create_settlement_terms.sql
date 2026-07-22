-- +goose Up
-- +goose StatementBegin
-- A CREDITOR'S TERMS toward one debtor (#186/#189) — what it charges, and how far it will let them
-- run.
--
-- One row rather than three tables because these are one relationship: the warehouse that charges you
-- 12k an order is the warehouse that caps you at 50m. Splitting them would mean three screens and
-- three chances to configure half of it.
--
-- Created here, with #186, because the ORDER FEES have to read it — the rates are what they charge.
-- #189 adds the RPCs and the screen that write it; until then every row is absent, which is exactly
-- the "no rate configured" case below.
CREATE TABLE settlement_terms (
    id                BIGSERIAL   PRIMARY KEY,

    -- The creditor: the team that SETS these terms. Opaque team_service id, no FK.
    team_id           BIGINT      NOT NULL,

    -- The debtor they apply to. ⚠ 0 IS THE DEFAULT ROW, applying to every team without one of their
    -- own. That is the whole override mechanism, and it is why 0 is not a valid team id anywhere
    -- else in this system.
    counterparty_id   BIGINT      NOT NULL DEFAULT 0,

    -- FLAT PER ORDER, whole rupiah, charged by a warehouse for fulfilling it. NO ROW AND NO RATE BOTH
    -- MEAN CHARGE NOTHING — a warehouse that has configured nothing is not silently billing anybody.
    handling_fee      BIGINT      NOT NULL DEFAULT 0,

    -- The markup this team takes when another team sells ITS product, in BASIS POINTS over the cost
    -- (2000 = 20%). Basis points rather than a float for the same reason money is BIGINT: a
    -- percentage that cannot be represented exactly is a fee that drifts.
    product_markup_bp BIGINT      NOT NULL DEFAULT 0,

    -- ⚠ NULL IS UNLIMITED. 0 IS NO CREDIT AT ALL.
    --
    -- They are opposites, and encoding unlimited as 0 is the classic trap: the day somebody genuinely
    -- wants to freeze a team's credit they will type 0 and grant infinite credit instead. Removing a
    -- limit means DELETING the row, never zeroing this column — which is why the API has a delete.
    credit_limit      BIGINT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT settlement_terms_no_self CHECK (team_id <> counterparty_id),
    CONSTRAINT settlement_terms_non_negative CHECK (
        handling_fee >= 0 AND product_markup_bp >= 0 AND (credit_limit IS NULL OR credit_limit >= 0)
    )
);

-- One row per (creditor, debtor), and one default row per creditor at counterparty_id = 0. The lookup
-- is "this debtor's row, else the default", so a duplicate would make which rate applies a matter of
-- which row the query happened to return.
CREATE UNIQUE INDEX settlement_terms_pair_idx
    ON settlement_terms (team_id, counterparty_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE settlement_terms;
-- +goose StatementEnd
