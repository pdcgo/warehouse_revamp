-- +goose Up
-- WHO HANDLED A RESTOCK, AND WHEN (owner).
--
-- A restock is worked by two teams and at least two people, and the row recorded neither: a delivery
-- that came up short had nobody to ask about it on either side, and a status said a request had been
-- accepted without saying when.
--
-- The user ids are OPAQUE user_service ids — no FK, like requesting_team_id and warehouse_id above
-- them. Names are resolved through UserByIDs at read time rather than snapshotted here: unlike a
-- line's sku/name (which must keep reading as it was ordered), a person's name is not part of what
-- was agreed, so a renamed user should read with their current name everywhere they appear.
--
-- Nothing is backfilled. A restock raised before this migration was raised by SOMEBODY, and inventing
-- an id for them would put a real person's name against work they may not have done — 0 says "not
-- recorded", which is the truth.
ALTER TABLE restock_requests
    ADD COLUMN created_by_user_id  BIGINT NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    ADD COLUMN accepted_by_user_id BIGINT NOT NULL DEFAULT 0 CHECK (accepted_by_user_id >= 0),
    ADD COLUMN accepted_at         TIMESTAMPTZ,
    ADD COLUMN cancelled_at        TIMESTAMPTZ;

-- The list filters on ONE of three dates, chosen by the caller (RestockDateField), always inside one
-- team's rows. Partial indexes rather than plain ones: at any moment most restocks are neither
-- accepted nor cancelled, so an index that skips those rows is the smaller half of the table.
--
-- Keyed by requesting_team_id because the list is scoped to a team before it is filtered by date.
-- The warehouse side reads the same rows through warehouse_id, which 00003 already indexes.
CREATE INDEX idx_restock_requests_accepted_at
    ON restock_requests (requesting_team_id, accepted_at)
    WHERE accepted_at IS NOT NULL;

CREATE INDEX idx_restock_requests_cancelled_at
    ON restock_requests (requesting_team_id, cancelled_at)
    WHERE cancelled_at IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_restock_requests_cancelled_at;
DROP INDEX IF EXISTS idx_restock_requests_accepted_at;

ALTER TABLE restock_requests
    DROP COLUMN created_by_user_id,
    DROP COLUMN accepted_by_user_id,
    DROP COLUMN accepted_at,
    DROP COLUMN cancelled_at;
