-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): a movement
-- posted by Root or the Administrator inside a team they hold no role in — in by the root-team bypass, not a
-- membership — says so beside actor_id, so a team can see which of its balances the platform moved. Derived from the
-- access interceptor's resolved role (san_auth.IsOverride), never sent by the caller.
--
-- Only a hand row can be stamped (opening balance, capital, reconcile, transfer, identify). A row a LISTENER posts from
-- an event (team_payment, withdrawal) is the system's: the event names its actor, not whether that act was an override.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE financial_account_logs ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE financial_account_logs DROP COLUMN is_override;
