-- +goose Up
-- +goose StatementBegin
-- SETTLEMENT IS TWO-PHASE (#188): the payer RECORDS, the creditor CONFIRMS, and only the confirm
-- posts to the ledger.
--
-- One side asserting a transfer is not evidence that it landed. Only the creditor can see the money
-- arrive, which is also why counterparties are teams only — an external party has no account and
-- could never confirm.
--
-- ⚠ THIS TABLE IS NOT THE LEDGER. It is the claim-and-agreement record; `settlement_entries` is what
-- moved. A payment that is recorded and never confirmed changes no balance at all.
CREATE TABLE settlement_payments (
    id                BIGSERIAL   PRIMARY KEY,

    -- WHO PAID and WHO WAS PAID. Opaque team_service ids, no FK. Not interchangeable: only the
    -- creditor may confirm.
    payer_team_id     BIGINT      NOT NULL,
    creditor_team_id  BIGINT      NOT NULL,

    -- Whole rupiah, ALWAYS POSITIVE. Direction is carried by the two team columns, never by a sign —
    -- a negative payment would be a refund, which is a different thing and is not modelled.
    amount            BIGINT      NOT NULL,

    -- recorded | confirmed | reversed. Stored as TEXT and mapped in the handler layer, exactly as
    -- `settlement_entries.source_type` is: a DB CHECK IN-list is one more place to drift when the
    -- enum grows (cf. #80).
    status            TEXT        NOT NULL DEFAULT 'recorded',

    -- Free text from the payer: a transfer reference, a bank, a date. A HINT for the human
    -- confirming, never something the system reads — which is why the LEDGER uses
    -- (source_type, source_id) instead of notes.
    note              TEXT        NOT NULL DEFAULT '',

    -- Why a confirmation was undone. Reversing says a person got it wrong, and the next person to
    -- read the history deserves to know what happened rather than seeing two entries that cancel out
    -- for no stated reason.
    reversal_reason   TEXT        NOT NULL DEFAULT '',

    -- Opaque user_service ids, no FK. Who claimed and who agreed — this is the record that says a
    -- PERSON, not a process, moved money.
    recorded_by       BIGINT      NOT NULL DEFAULT 0,
    confirmed_by      BIGINT      NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at      TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT settlement_payments_no_self CHECK (payer_team_id <> creditor_team_id),
    -- Zero would be a payment that settles nothing while looking like an act; negative would be a
    -- refund wearing a payment's clothes.
    CONSTRAINT settlement_payments_positive CHECK (amount > 0)
);

-- The creditor's inbox: "what is waiting for me to confirm", the query behind the badge (#188 Q10).
-- A payment nobody notices is a debt that stays open for no reason.
CREATE INDEX settlement_payments_awaiting_idx
    ON settlement_payments (creditor_team_id, status, id DESC);

-- The payer's own history, for the same screen read from the other side.
CREATE INDEX settlement_payments_payer_idx
    ON settlement_payments (payer_team_id, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE settlement_payments;
-- +goose StatementEnd
