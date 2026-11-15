-- +goose Up
-- +goose StatementBegin

-- THE LEGACY SUPPLIER TABLES GO (existing-suppliers-move-with-their-ids, docs/business/supplier/context_decision.md:
-- "dropped by a LATER inventory migration, once the move has run everywhere").
--
-- 00023 renamed inventory's own `suppliers` / `supplier_channels` to `legacy_*` so supplier_service could create its
-- tables under those names, and `san supplier move` copied every row across with its id kept. The move has run on every
-- database there is (revamp-has-no-real-orders-yet), nothing else ever read these tables, and the command is retired
-- with this migration.
--
-- ⚠ THE GUARD. A database whose legacy rows were never moved would lose them here, so this REFUSES — nothing dropped,
-- the version not recorded — while any legacy row is missing from supplier_service as the move writes it:
--   * a supplier: under its id, of the same team and created_at (the move copies both and no edit changes them — the
--     move's own test for "moved by an earlier run", tools/san's refuseCollisions);
--   * an ONLINE store: under its id, of the same supplier and created_at. An OFFLINE store never became a row there —
--     the move folded it into its supplier (the-supplier-lists-only-its-online-stores) — so it is not looked for.
-- It looks only when a legacy row EXISTS: on a fresh database the tables are empty and it passes, and there
-- `migrate up-all` runs inventory_service BEFORE supplier_service (tools/san/migrate.go), so supplier_service's tables do
-- not exist yet — they are read only through EXECUTE, after to_regclass has found them.
DO $guard$
DECLARE
    unmoved_suppliers TEXT;
    unmoved_stores    TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM legacy_suppliers) AND NOT EXISTS (SELECT 1 FROM legacy_supplier_channels) THEN
        RETURN;
    END IF;

    IF to_regclass('suppliers') IS NULL OR to_regclass('supplier_channels') IS NULL THEN
        RAISE EXCEPTION 'the legacy suppliers were never moved: supplier_service has no suppliers table yet — migrate '
            'supplier_service, then run san supplier move first (retired with inventory_service 00046: run it from a '
            'checkout before this migration), then migrate again';
    END IF;

    EXECUTE $q$
        SELECT string_agg(l.id::text, ', ' ORDER BY l.id)
        FROM legacy_suppliers l
        WHERE NOT EXISTS (
            SELECT 1 FROM suppliers s
            WHERE s.id = l.id AND s.team_id = l.team_id AND s.created_at = l.created_at
        )
    $q$ INTO unmoved_suppliers;

    EXECUTE $q$
        SELECT string_agg(l.id::text, ', ' ORDER BY l.id)
        FROM legacy_supplier_channels l
        WHERE l.type <> 'offline'
          AND NOT EXISTS (
            SELECT 1 FROM supplier_channels c
            WHERE c.id = l.id AND c.supplier_id = l.supplier_id AND c.created_at = l.created_at
          )
    $q$ INTO unmoved_stores;

    IF unmoved_suppliers IS NOT NULL OR unmoved_stores IS NOT NULL THEN
        RAISE EXCEPTION 'the legacy suppliers were never moved (legacy suppliers %, legacy stores % are not in '
            'supplier_service) — run san supplier move first (retired with inventory_service 00046: run it from a '
            'checkout before this migration), then migrate again',
            COALESCE(unmoved_suppliers, 'none'), COALESCE(unmoved_stores, 'none');
    END IF;
END
$guard$;

-- Each table takes its primary key, its indexes and its constraints with it; its id sequence is OWNED by the id column
-- (BIGSERIAL — the rename kept that) and goes too. The explicit sequence drops only make sure no orphan stays behind.
DROP TABLE legacy_supplier_channels;
DROP TABLE legacy_suppliers;
DROP SEQUENCE IF EXISTS legacy_supplier_channels_id_seq;
DROP SEQUENCE IF EXISTS legacy_suppliers_id_seq;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- The two tables come back EMPTY, exactly as 00023 left them — same columns, constraint, index and sequence names — so
-- 00023's Down can still rename them back to `suppliers` / `supplier_channels`. The rows do not come back: they live in
-- supplier_service, ids kept.
CREATE TABLE legacy_suppliers (
    id          BIGSERIAL   PRIMARY KEY,
    team_id     BIGINT      NOT NULL,
    code        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    contact     TEXT        NOT NULL DEFAULT '',
    province    TEXT        NOT NULL DEFAULT '',
    city        TEXT        NOT NULL DEFAULT '',
    address     TEXT        NOT NULL DEFAULT '',
    description TEXT        NOT NULL DEFAULT '',
    deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT suppliers_code_present CHECK (code <> ''),
    CONSTRAINT suppliers_name_present CHECK (name <> '')
);

CREATE UNIQUE INDEX legacy_suppliers_team_code_active_unique ON legacy_suppliers (team_id, code) WHERE deleted = FALSE;
CREATE INDEX legacy_suppliers_team_active_idx ON legacy_suppliers (team_id) WHERE deleted = FALSE;

CREATE TABLE legacy_supplier_channels (
    id           BIGSERIAL   PRIMARY KEY,
    supplier_id  BIGINT      NOT NULL
        CONSTRAINT supplier_channels_supplier_id_fkey REFERENCES legacy_suppliers (id) ON DELETE CASCADE,
    type         TEXT        NOT NULL,
    marketplace  TEXT        NOT NULL DEFAULT '',
    name         TEXT        NOT NULL,
    url          TEXT        NOT NULL DEFAULT '',
    contact      TEXT        NOT NULL DEFAULT '',
    location     TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT supplier_channels_name_present CHECK (name <> '')
);

CREATE INDEX legacy_supplier_channels_supplier_idx ON legacy_supplier_channels (supplier_id);

-- +goose StatementEnd
