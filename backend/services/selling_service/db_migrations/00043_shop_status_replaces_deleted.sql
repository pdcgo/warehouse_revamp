-- +goose Up
-- +goose StatementBegin
-- A SHOP IS CLOSED, NEVER DELETED (a-shop-is-closed-never-deleted): `status` (open · closed) and `closed_at` replace
-- `deleted`. A closed shop takes no new selling while its payouts keep running (a-closed-shop-refuses-only-new-selling).
ALTER TABLE shops
    ADD COLUMN status    TEXT        NOT NULL DEFAULT 'open',
    ADD COLUMN closed_at TIMESTAMPTZ;

-- THE SHOPS ALREADY DELETED BECOME CLOSED, closed_at = their updated_at — the moment the delete stamped. Their codes are
-- left as they are, even one an open shop reused after the delete (a-shop-code-is-unique-among-open-shops: the
-- migration rewrites no codes); reopening such a shop is refused until one is renamed.
UPDATE shops
SET status = 'closed', closed_at = updated_at
WHERE deleted;

DROP INDEX shops_team_code_active_unique;
DROP INDEX shops_team_active_idx;

ALTER TABLE shops DROP COLUMN deleted;

-- Two states, fixed by the decision — and a close date exactly when closed.
ALTER TABLE shops
    ADD CONSTRAINT shops_status_known CHECK (status IN ('open', 'closed')),
    ADD CONSTRAINT shops_closed_at_when_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL));

-- A code is unique among the team's OPEN shops (a-shop-code-is-unique-among-open-shops): closing frees it, and a
-- reopen meets this index if an open shop took it meanwhile.
CREATE UNIQUE INDEX shops_team_code_open_unique ON shops (team_id, shop_code) WHERE status = 'open';

-- ShopList by status — open (the default), closed, or all (the-close-shop-prototype-is-accepted): one index serves
-- every branch, where the old partial (team_id) WHERE NOT deleted served the live list only.
CREATE INDEX shops_team_status_idx ON shops (team_id, status);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE shops ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE shops
SET deleted = TRUE
WHERE status = 'closed';

DROP INDEX shops_team_status_idx;
DROP INDEX shops_team_code_open_unique;

ALTER TABLE shops
    DROP CONSTRAINT shops_closed_at_when_closed,
    DROP CONSTRAINT shops_status_known,
    DROP COLUMN closed_at,
    DROP COLUMN status;

CREATE UNIQUE INDEX shops_team_code_active_unique ON shops (team_id, shop_code) WHERE deleted = FALSE;
CREATE INDEX shops_team_active_idx ON shops (team_id) WHERE deleted = FALSE;
-- +goose StatementEnd
