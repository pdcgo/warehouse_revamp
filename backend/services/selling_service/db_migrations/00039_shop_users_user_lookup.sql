-- +goose Up
-- +goose StatementBegin
-- A PERSON'S GRANTS, by person (audits/services/selling_service/performances/ShopList.md). ShopList's `writable` filter
-- — the order form's shop picker for a CS (a-write-needs-a-grant-or-a-manager) — asks for the team's shops the caller
-- is granted, and until now no index led with user_id: the count scanned every grant of every team. (user_id, shop_id)
-- rather than (user_id) alone: the filter needs only those two columns, so its probe is an index-only scan on the
-- caller's grants, never a heap visit. It also serves the member-removed listener's delete of a person's grants
-- (removing-a-member-drops-their-shop-access) and leaves shop_users_unique (shop_id, user_id) for the per-shop reads.
CREATE INDEX shop_users_user_shop_idx ON shop_users (user_id, shop_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX shop_users_user_shop_idx;
-- +goose StatementEnd
