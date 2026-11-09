-- +goose Up
-- +goose StatementBegin
-- SEVERAL ORDERS' SHIPPING LABELS MERGED INTO ONE PDF (a-warehouse-prints-the-labels-of-orders-it-ships) — written by the
-- order service's OrderLabels under the warehouse that prints them, never uploaded by a browser, and read back through
-- an expiring signed link. PRIVATE: every label on it names a buyer and an address.
--
-- ⚠ The CHECK must list every value resourceTypeFromText() can read, or the merged file fails at INSERT — the proto
-- enum, resourceTypeToText/FromText, isPublic AND this constraint move together.
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof',
                             'settlement_statement', 'order_export', 'table_export', 'order_labels'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof',
                             'settlement_statement', 'order_export', 'table_export'));
-- +goose StatementEnd
