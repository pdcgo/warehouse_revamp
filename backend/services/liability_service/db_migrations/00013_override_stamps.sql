-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): a write by
-- Root or the Administrator inside a team they hold no role in — in by the root-team bypass, not a membership — says
-- so beside the actor it records, so a team can see what the platform did inside it. Derived from the access
-- interceptor's resolved role (san_auth.IsOverride), never sent by the caller. `liability_terms_logs.override`
-- (00008) was the first; this brings the service's other actor columns in line.
--
--   liability_logs              both legs of a posting a PERSON made: a payment's confirm, a stock damage the warehouse
--                               recorded. A leg posted from an EVENT (an order's fees, a restock's courier charge,
--                               an order's reversal) is the system's and reads false.
--   liability_payment_requests  the creditor who asked.
--   liability_payments          ONE FLAG PER ACTOR COLUMN: the row records two acts by two people — the payer's
--                               record and the creditor's confirm — so one flag could not say which it meant.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE liability_logs             ADD COLUMN is_override           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE liability_payment_requests ADD COLUMN is_override           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE liability_payments         ADD COLUMN recorded_is_override  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE liability_payments         ADD COLUMN confirmed_is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE liability_payments         DROP COLUMN confirmed_is_override;
ALTER TABLE liability_payments         DROP COLUMN recorded_is_override;
ALTER TABLE liability_payment_requests DROP COLUMN is_override;
ALTER TABLE liability_logs             DROP COLUMN is_override;
