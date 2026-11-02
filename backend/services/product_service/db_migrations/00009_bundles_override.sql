-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): a bundle
-- made by Root or the Administrator inside a team they hold no role in — in by the root-team bypass, not a membership —
-- says so beside created_by_user_id, so a team can see which of its bundles the platform made. Derived from the access
-- interceptor's resolved role (san_auth.IsOverride), never sent by the caller. Set once at create, as the creator is.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE bundles ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE bundles DROP COLUMN is_override;
