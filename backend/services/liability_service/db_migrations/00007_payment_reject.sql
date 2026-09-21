-- +goose Up
-- +goose StatementBegin
-- THE CREDITOR MAY NOW REFUSE A CLAIM (balance_context.md §Payment Flow).
--
-- The flow's *"Is Payment Correct?"* branch has always had a `no` arm, and the lifecycle diagram
-- makes `reject` terminal beside `accept`. Until now the shipped statuses were recorded · confirmed ·
-- reversed, so a creditor faced with a payment that never landed could only leave it at RECORDED
-- forever, or CONFIRM and then REVERSE — which writes two real ledger movements for money that never
-- moved, and leaves the pair's history telling a story that did not happen.
--
-- ⚠ THE STATUS ITSELF NEEDS NO SCHEMA CHANGE. `status` is TEXT, for the same reason
-- `liability_logs.source_type` is: the set of states is a design decision, not a database one, and
-- widening it must not require a migration in lock-step with a deploy.
--
-- What DOES change is the reason column. `reversal_reason` was named when exactly one act could fill
-- it. Two acts fill it now — a rejection and a reversal — and the STATUS already says which, so one
-- column serves both. Two columns would leave one of them permanently null on every row, and every
-- reader would have to know to coalesce them.
ALTER TABLE liability_payments
    RENAME COLUMN reversal_reason TO reason;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ THE DOWN LOSES REJECTION REASONS, and it cannot do otherwise. Rows written while this migration
-- was up may carry a reason for a REJECTED payment — a status the column's old name cannot describe.
-- The rename is reversible; the meaning of what is in it is not.
ALTER TABLE liability_payments
    RENAME COLUMN reason TO reversal_reason;
-- +goose StatementEnd
