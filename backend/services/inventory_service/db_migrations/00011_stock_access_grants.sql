-- +goose Up
-- +goose StatementBegin
-- The arrangement by which a WAREHOUSE lets a SELLING team draw its stock (#147).
--
-- It exists because a CS person placing an order holds a role in the SELLING team while the stock
-- belongs to the WAREHOUSE team, and the access interceptor's rule is absolute: a role in another team
-- does not authorize this one. What was missing is the real business fact — this warehouse stores goods
-- for that selling team — recorded here rather than inferred, so it is visible, revocable, and FAILS
-- CLOSED: no grant, no draw.
--
-- Both ids are opaque team_service ids (HARD RULE 3) — no FK. Scope is the access interceptor's job.
--
-- ⚠ INERT until #148. Nothing reads these rows yet; teaching the scope check to consult them is its own
-- change, because that one touches the interceptor every RPC runs through.
CREATE TABLE stock_access_grants (
    id              BIGSERIAL   PRIMARY KEY,

    -- The warehouse whose stock may be drawn — the team that GRANTS.
    warehouse_id    BIGINT      NOT NULL,
    -- The selling team allowed to draw it.
    selling_team_id BIGINT      NOT NULL,

    -- Soft delete, so a revocation is auditable: "who was allowed to take our stock, and when did that
    -- stop" is exactly the question someone asks after a discrepancy, and a deleted row cannot answer
    -- it. Also lets a grant be re-issued later without losing that it once lapsed.
    revoked         BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A warehouse granting ITSELF is meaningless: it already has full access through its own roles, so
    -- the row would be a no-op that reads like a permission. Refused in the handler too — this is the
    -- backstop, not the message.
    CONSTRAINT stock_access_not_self CHECK (warehouse_id <> selling_team_id)
);

-- One ACTIVE grant per pair. Partial, so revoking frees the pair to be granted again later — the same
-- shape as racks_warehouse_code_active_unique, and for the same reason: a soft delete must not
-- permanently consume the identity it held.
CREATE UNIQUE INDEX stock_access_pair_active_unique
    ON stock_access_grants (warehouse_id, selling_team_id) WHERE revoked = FALSE;

-- "Who may draw from this warehouse" — the list screen, and (from #148) the scope check's lookup.
CREATE INDEX stock_access_warehouse_active_idx
    ON stock_access_grants (warehouse_id) WHERE revoked = FALSE;
-- The other direction: "which warehouses may this selling team draw from", which is what an order
-- placed by a selling team will ask (#149).
CREATE INDEX stock_access_selling_active_idx
    ON stock_access_grants (selling_team_id) WHERE revoked = FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE stock_access_grants;
-- +goose StatementEnd
