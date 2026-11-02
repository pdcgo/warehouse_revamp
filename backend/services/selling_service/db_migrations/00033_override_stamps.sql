-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): when Root or
-- the Administrator writes inside a team they hold no role in — in by the root-team bypass, not a membership — the row
-- that records who acted says so, so a team can see what the platform did inside it. Derived from the access
-- interceptor's resolved role (san_auth.IsOverride), never sent by the caller.
--
--   orders              — beside created_by_user_id: the order was placed from outside the team.
--   order_timeline_logs — beside actor_id: the move, the note or the receipt change came from outside the team the
--                         call was scoped to (the warehouse's, for a warehouse-side move).
--   order_drafts        — beside author_user_id, and it FOLLOWS THE PUSH as the author does.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE orders              ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_timeline_logs ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_drafts        ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE order_drafts        DROP COLUMN is_override;
ALTER TABLE order_timeline_logs DROP COLUMN is_override;
ALTER TABLE orders              DROP COLUMN is_override;
