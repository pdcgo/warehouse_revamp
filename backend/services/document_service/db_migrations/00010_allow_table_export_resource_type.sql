-- +goose Up
-- +goose StatementBegin
-- A SCREEN'S TABLE EXPORTED AS .xlsx — a supplier page tab's (each-supplier-tab-exports-its-own-table), on the order
-- list's pattern (one-export-is-the-list-as-a-file): stored as the person who exported it and read back through an
-- expiring signed link. PRIVATE: it is a team's working figures.
--
-- ⚠ The CHECK must list every value resourceTypeToText() can produce, or an upload of a newly-added type fails at
-- INSERT — the proto enum, resourceTypeToText/FromText, isPublic AND this constraint move together.
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof',
                             'settlement_statement', 'order_export', 'table_export'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof',
                             'settlement_statement', 'order_export'));
-- +goose StatementEnd
