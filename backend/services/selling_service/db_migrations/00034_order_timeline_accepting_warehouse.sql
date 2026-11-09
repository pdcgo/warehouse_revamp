-- +goose Up
-- WHERE A RETURN WAS ACCEPTED (docs/business/order/context_decision.md#the-accept-records-where-it-was-accepted): the
-- warehouse whose staff accepted the returned parcel — return → return_completed — taken from the team the accept is
-- scoped to, asked of nobody. It is not always the order's warehouse: the parcel comes back to the selling team's
-- CONFIGURED return warehouse (a-return-may-land-in-another-warehouse), and to whichever building an old label still
-- names (a-stale-return-location-is-accepted) — so a mismatch is visible here, to be fixed by a warehouse transfer.
--
-- On the `return_completed` row, the proposed home the decision names, rather than a column on `orders`: the row already
-- marks that moment with its actor and `from = warehouse`. 0 on every other row — no other move records a building, and
-- an accept before this column recorded none.
--
-- Opaque team_service id, no FK. The courier's charge at that door is owed to this warehouse (OrderReturnAccepted).
ALTER TABLE order_timeline_logs ADD COLUMN accepting_warehouse_id BIGINT NOT NULL DEFAULT 0;

-- THE RETURN WAREHOUSE READS A TEAM'S RETURNS (a-return-may-land-in-another-warehouse): every read of an order now has a
-- third reader, the selling team's configured return warehouse, for that team's orders in `return` or `return_completed`
-- only (orderReaders in selling_v1). Its arm of the scope is `team_id = ANY(…) AND status IN (…)`, and with only
-- orders_team_idx it is answered by reading EVERY order of those teams — all they ever sold — to keep the few that came
-- back; the planner priced that above a sequential scan of the whole table, on every warehouse's list.
--
-- Partial on exactly the arm's statuses, so it holds the returns alone and the arm joins the other two in one BitmapOr.
CREATE INDEX orders_return_team_idx ON orders (team_id) WHERE status IN ('return', 'return_completed');

-- +goose Down
DROP INDEX orders_return_team_idx;
ALTER TABLE order_timeline_logs DROP COLUMN accepting_warehouse_id;
