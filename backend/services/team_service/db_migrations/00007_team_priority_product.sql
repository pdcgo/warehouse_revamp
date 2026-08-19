-- +goose Up
-- THE PRIORITY-PRODUCT FEATURE (owner).
--
-- ROOT marks a TEAM as carrying the feature, and that makes the team's ENTIRE catalogue priority:
-- every product it owns is a priority product to everybody discovering products. It is what backs
-- the product picker's *Priority Product* tab, which sits between *My Product* and *Other Product*.
--
-- WHY A COLUMN ON `teams` AND NOT ON `products`:
--
--   The decision is about a team, not about a product. A per-product flag would have to be set once
--   per row and kept in step as the catalogue grows, and a team that gained the feature would need a
--   backfill; a team flag is one write and is automatically true of everything the team later adds.
--
-- WHY NOT `team_infos`:
--
--   That table is the team's OWN settings, and TeamInfoUpdate is callable by ROLE_TEAM_OWNER. A
--   capability granted by root must not live in a message a team owner can write, or a team could
--   grant itself the feature. This is a policy boundary, not a layout preference — keep it here.
--
-- HOW product_service USES IT — it does not read this column at all. It cannot: `teams` belongs to
-- this service and product_service must not join to it (HARD RULE 3 — services stay independent).
-- The caller reads the priority team IDS from TeamList and passes them to ProductDiscover as
-- `owner_team_ids` / `exclude_owner_team_ids`, so product_service filters by ids it was handed and
-- never learns what "priority" means. One flag, one owner, two independent schemas.
--
-- NOT NULL DEFAULT false: absence of the feature is the ordinary state, and a nullable capability
-- flag would give "not granted" two spellings.
ALTER TABLE teams ADD COLUMN priority_product BOOLEAN NOT NULL DEFAULT false;

-- PARTIAL, on the true rows only. The whole point of the feature is that FEW teams have it (owner),
-- so an index over every team would be mostly dead weight — this one holds only the handful that
-- answer the query the picker actually runs: "which teams are priority?".
CREATE INDEX idx_teams_priority_product ON teams (id) WHERE priority_product AND NOT deleted;

-- +goose Down
DROP INDEX IF EXISTS idx_teams_priority_product;
ALTER TABLE teams DROP COLUMN priority_product;
