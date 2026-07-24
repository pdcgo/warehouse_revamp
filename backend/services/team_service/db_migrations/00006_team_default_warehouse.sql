-- +goose Up
-- THE WAREHOUSE A SELLING TEAM SHIPS FROM BY DEFAULT (#145).
--
-- Every order must say which warehouse fulfils it (#72) — an order without one cannot be honoured. But
-- a selling team almost always ships from the same building, so making somebody choose it on every
-- single order is asking a question whose answer never changes.
--
-- This is that answer, held once. It is a DEFAULT, not a rule: the order form pre-selects it and the
-- person can still pick another, and the server keeps refusing an order that names none (#72). A
-- fallback applied server-side would quietly undo that refusal, which exists precisely so a
-- warehouse-less order can never reach the database.
--
-- Nullable and opaque, exactly like return_warehouse_id beside it: warehouses live in this service's
-- own `teams` table, but the column follows the same shape so both read alike. NULL = not configured.
ALTER TABLE team_infos ADD COLUMN default_warehouse_id BIGINT;

-- +goose Down
ALTER TABLE team_infos DROP COLUMN default_warehouse_id;
