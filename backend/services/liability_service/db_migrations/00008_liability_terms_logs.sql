-- +goose Up
-- +goose StatementBegin
-- WHO CHANGED A CREDIT LIMIT, WHEN, AND WHY (a-limit-change-is-recorded).
--
-- The threshold is the ONLY control this design has — there is no settlement cycle, no due date and
-- no overdue state (no-overdue-only-the-threshold) — so lowering a limit is the single most
-- consequential act in the balance context: it stops a team trading. An unrecorded override is the
-- difference between a supervisor and a back door.
--
-- ⚠ THE NAME. `liability_terms_logs`, not `liability_logs` (two-logs-two-names). The pair detail
-- carries TWO logs and they must never merge: this one is a RULE that changed, `liability_logs` is
-- MONEY that moved. Only the second is a ledger, and letting either own the bare word "log" would
-- make "the log" ambiguous on the one screen that shows both.
CREATE TABLE liability_terms_logs (
    id              BIGSERIAL   PRIMARY KEY,

    -- The creditor whose terms these are, and the debtor they apply to. ⚠ 0 IS THE DEFAULT ROW —
    -- the rule every other row is an exception to — so this column has no `> 0` check.
    team_id         BIGINT      NOT NULL,
    counterparty_id BIGINT      NOT NULL,

    -- WHO. Opaque user_service id; no FK (HARD RULE 3). 0 when the write carried no identity.
    actor_id        BIGINT      NOT NULL DEFAULT 0,

    -- ⚠ BOTH LIMITS ARE NULLABLE, AND THAT IS THE WHOLE POINT OF THIS TABLE.
    --
    --   NULL  no limit at all — unlimited
    --   0     frozen entirely — the next order is refused whatever the balance
    --   n     a real ceiling
    --
    -- Three acts, and a NOT NULL column flattens the first into the second: "they removed the limit"
    -- would be recorded as "they froze the team", which is its exact opposite and the more damaging
    -- of the two. A log that cannot tell them apart is worse than no log, because it reads as
    -- authoritative.
    old_credit_limit      BIGINT,
    new_credit_limit      BIGINT,

    -- The other two terms have no third state — 0 means "charge nothing" for both — so they are
    -- plain columns.
    old_handling_fee      BIGINT NOT NULL DEFAULT 0,
    new_handling_fee      BIGINT NOT NULL DEFAULT 0,
    old_product_markup_bp BIGINT NOT NULL DEFAULT 0,
    new_product_markup_bp BIGINT NOT NULL DEFAULT 0,

    -- WHY. Required by the application when `override` is true, optional otherwise: a creditor
    -- setting its own terms owes nobody an explanation, somebody else changing them does — and that
    -- difference is the entire definition of an override here.
    reason          TEXT        NOT NULL DEFAULT '',

    -- TRUE when the actor held no role in the creditor team, i.e. they got in by the root-team
    -- bypass (terms-are-team-scoped-root-is-global).
    --
    -- ⚠ DERIVED BY THE SERVER FROM THE RESOLVED ROLE, never sent by the caller. Whether a write was
    -- an override is a fact about who made it, and the caller is the one party that cannot be
    -- trusted to report it.
    override        BOOLEAN     NOT NULL DEFAULT FALSE,

    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The screen reads one creditor's history, newest first, optionally narrowed to one pair. `id`
-- breaks ties so paging is stable when two changes land in the same clock tick.
CREATE INDEX liability_terms_logs_team_idx
    ON liability_terms_logs (team_id, changed_at DESC, id DESC);

CREATE INDEX liability_terms_logs_pair_idx
    ON liability_terms_logs (team_id, counterparty_id, changed_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE liability_terms_logs;
-- +goose StatementEnd
