-- +goose Up
-- THE TEAM RECORD HOLDS NO RETURN WAREHOUSE AND NO RETURN USER (owner, 2026-10-17 and 2026-10-19).
--
-- A selling team's return warehouse is a row of the order context's team_return_configurations — the table the
-- order create check reads without calling this service (the-return-warehouse-lives-in-team-return-configurations).
-- Kept here as well, it would be one fact typed in two places. The return user was read by nothing
-- (return-user-id-is-dropped).
--
-- Dropped, not copied: nothing read either column, and a team sets its return warehouse again on the settings
-- screen, as it must before the create check is turned on.
ALTER TABLE team_infos
    DROP COLUMN return_warehouse_id,
    DROP COLUMN return_user_id;

-- +goose Down
-- The columns come back empty — what the Up dropped is not recoverable.
ALTER TABLE team_infos
    ADD COLUMN return_warehouse_id BIGINT,
    ADD COLUMN return_user_id      BIGINT;
