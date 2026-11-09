-- +goose Up
-- A CREDITOR MAY ASK ITS DEBTOR TO PAY (a-creditor-may-request-payment): a notice, never an entry. It posts nothing, blocks nothing and has
-- no due date; payment still starts with the debtor. ONE per pair — sending again replaces it, and the debtor recording
-- a payment to that creditor clears it.
CREATE TABLE liability_payment_requests (
    id                   BIGSERIAL   PRIMARY KEY,
    creditor_team_id     BIGINT      NOT NULL,
    debtor_team_id       BIGINT      NOT NULL,
    -- What the debtor owed when it was asked, whole rupiah — the moment's figure.
    amount               BIGINT      NOT NULL CHECK (amount > 0),
    requested_by_user_id BIGINT      NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT liability_payment_requests_one_per_pair UNIQUE (creditor_team_id, debtor_team_id),
    CONSTRAINT liability_payment_requests_two_teams CHECK (creditor_team_id <> debtor_team_id)
);

-- The debtor's side reads its requests by debtor.
CREATE INDEX liability_payment_requests_debtor_idx ON liability_payment_requests (debtor_team_id);

-- +goose Down
DROP TABLE liability_payment_requests;
