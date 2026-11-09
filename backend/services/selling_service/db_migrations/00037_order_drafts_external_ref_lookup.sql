-- +goose Up
-- THE DUPLICATE-REF WARNING SEEKS ITS DRAFTS (audits/services/selling_service/performances/OrderDraftByExternalRefs.md).
-- OrderDraftByExternalRefs asks for a team's drafts in ONE shop on a list of marketplace refs, and carries no `source`,
-- so the unique (team_id, source, external_id) index could not seek on external_id and the read walked every draft of
-- the team. This index is the lookup's own key: one seek per ref, at any backlog.
--
-- Not unique: two apps may push the same ref into one shop, and the unique key stays (team_id, source, external_id).
CREATE INDEX order_drafts_team_shop_external_idx ON order_drafts (team_id, shop_id, external_id);

-- +goose Down
DROP INDEX IF EXISTS order_drafts_team_shop_external_idx;
