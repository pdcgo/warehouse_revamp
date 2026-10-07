-- +goose Up
-- +goose StatementBegin

-- THE SUPPLIER LEAVES THIS SERVICE (the-supplier-gets-its-own-service, docs/business/supplier/context_decision.md).
--
-- supplier_service creates its own `suppliers` and `supplier_channels`. Every service shares one database, so
-- the names — and the schema-wide names of their indexes and sequences — must be freed here first. The rows
-- are NOT dropped: `san supplier move` copies them into supplier_service, ids kept
-- (existing-suppliers-move-with-their-ids), and a LATER migration drops these legacy tables once the move has
-- run on every database. Dropping them here would lose the rows before the command could read them.
--
-- ⚠ ORDER: this must run before supplier_service's 00001. inventory_service is pinned before it in every
-- apply order (san migrate up-all, san_testdb, the e2e global setup).

-- A restock's supplier is now an OPAQUE id into supplier_service, as an order's shop is — a new supplier is
-- created there and would never satisfy a foreign key into the legacy table.
ALTER TABLE restock_requests DROP CONSTRAINT IF EXISTS restock_requests_supplier_id_fkey;

ALTER TABLE supplier_channels RENAME TO legacy_supplier_channels;
ALTER INDEX supplier_channels_pkey RENAME TO legacy_supplier_channels_pkey;
ALTER INDEX supplier_channels_supplier_idx RENAME TO legacy_supplier_channels_supplier_idx;
ALTER SEQUENCE supplier_channels_id_seq RENAME TO legacy_supplier_channels_id_seq;

ALTER TABLE suppliers RENAME TO legacy_suppliers;
ALTER INDEX suppliers_pkey RENAME TO legacy_suppliers_pkey;
ALTER INDEX suppliers_team_code_active_unique RENAME TO legacy_suppliers_team_code_active_unique;
ALTER INDEX suppliers_team_active_idx RENAME TO legacy_suppliers_team_active_idx;
ALTER SEQUENCE suppliers_id_seq RENAME TO legacy_suppliers_id_seq;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- ⚠ supplier_service must be migrated down FIRST — its tables hold the names this gives back. The foreign
-- key is not restored: a restock may by now name a supplier that exists only in supplier_service.
ALTER SEQUENCE legacy_suppliers_id_seq RENAME TO suppliers_id_seq;
ALTER INDEX legacy_suppliers_team_active_idx RENAME TO suppliers_team_active_idx;
ALTER INDEX legacy_suppliers_team_code_active_unique RENAME TO suppliers_team_code_active_unique;
ALTER INDEX legacy_suppliers_pkey RENAME TO suppliers_pkey;
ALTER TABLE legacy_suppliers RENAME TO suppliers;

ALTER SEQUENCE legacy_supplier_channels_id_seq RENAME TO supplier_channels_id_seq;
ALTER INDEX legacy_supplier_channels_supplier_idx RENAME TO supplier_channels_supplier_idx;
ALTER INDEX legacy_supplier_channels_pkey RENAME TO supplier_channels_pkey;
ALTER TABLE legacy_supplier_channels RENAME TO supplier_channels;

-- +goose StatementEnd
