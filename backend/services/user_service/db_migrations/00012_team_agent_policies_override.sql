-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): a team's
-- agent policy turned on or off by Root or the Administrator from outside the team — in by the root-team bypass, not a
-- membership — says so beside updated_by_user_id, as team_member_logs.is_override (00005) already does for a
-- membership. Derived from the access interceptor's resolved role (san_auth.IsOverride), never sent by the caller. It
-- follows the last setter, as updated_by_user_id does.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE team_agent_policies ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE team_agent_policies DROP COLUMN is_override;
