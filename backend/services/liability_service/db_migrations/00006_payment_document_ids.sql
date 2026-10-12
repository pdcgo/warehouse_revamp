-- +goose Up
-- +goose StatementBegin
-- PROOF THAT THE MONEY LEFT A BANK (a-payment-must-carry-proof).
--
-- `balance_context.md` §Payment Flow has the payer BRING proof of the transfer and the creditor CHECK
-- IT MANUALLY. Until now a payment carried 500 characters of free-text `note` and nothing else, so
-- the middle step of that flow had nothing to look at — the creditor was accepting on the payer's
-- word, which is precisely what two-phase confirmation declines to trust.
CREATE TABLE liability_payment_documents (
    id         BIGSERIAL   PRIMARY KEY,

    payment_id BIGINT      NOT NULL REFERENCES liability_payments (id) ON DELETE CASCADE,

    -- A document_service id. ⚠ NO FK, and none is possible — that table belongs to another service
    -- (HARD RULE 3), exactly as `liability_logs.source_id` names an order it cannot reference.
    document_id TEXT       NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⚠ A CHILD TABLE RATHER THAN A `TEXT[]` COLUMN. The array reads better for a screen that always
-- loads the whole list, and it would have been this system's FIRST array column and needed a new
-- driver dependency to scan it — a large commitment for one field. This is the shape every other
-- one-to-many here already has, and it makes "which payments cite document D" a query rather than a
-- scan.

-- The same document attached twice to one payment is the same fact, not two of them.
CREATE UNIQUE INDEX liability_payment_documents_unique
    ON liability_payment_documents (payment_id, document_id);

-- ⚠ NO CONSTRAINT REQUIRING AT LEAST ONE, and that is not an oversight.
--
-- The requirement lives in the CONTRACT (`LiabilityPaymentRecordRequest.document_ids` has
-- `min_items: 1`), which binds every new payment. It cannot bind the ones already recorded: a payment
-- made before today legitimately has none, and no migration can invent a bank slip. A NOT NULL child
-- would have to be forged for history, and a payment pointing at a document that does not exist is
-- worse than one pointing at nothing — the first reads as evidence that was lost, the second as
-- evidence that was never given.
--
-- ⚠ WHETHER THE CREDITOR MAY READ ONE IS NOT HERE. That is document_service's `document_shares` row,
-- granted by the payer before this one is written. This service records what the payment CLAIMS; it
-- does not decide who may see it.
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE liability_payment_documents;
-- +goose StatementEnd
