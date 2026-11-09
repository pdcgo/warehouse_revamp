-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): a row
-- posted by Root or the Administrator inside a team they hold no role in — in by the root-team bypass, not a
-- membership — says so beside its actor_id, so a team can see what the platform wrote into its ledger. Derived from
-- the access interceptor's resolved role (san_auth.IsOverride), never sent by the caller.
--
-- Only SettlementPost's rows can be stamped: a row opened or cancelled from an order's EVENT is the system's, and the
-- event names the order's creator, not whether the placement was an override.
--
-- `order_settlements` is NOT stamped: its created_by_user_id is the ORDER's creator copied from selling, not who
-- acted here — that act's stamp is selling's `orders.is_override`.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE settlement_logs ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE settlement_logs DROP COLUMN is_override;
