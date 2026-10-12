-- +goose Up
-- +goose StatementBegin
-- A MARKETPLACE SETTLEMENT STATEMENT — the .xlsx a platform exports, stored by the settlement importer
-- before it reads it (the-import-is-one-streamed-call). PRIVATE: it lists every order and what the
-- platform took from each.
--
-- ⚠ The CHECK must list every value resourceTypeToText() can produce, or an upload of a newly-added
-- type fails at INSERT — the proto enum, resourceTypeToText/FromText, isPublic AND this constraint move
-- together.
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof',
                             'settlement_statement'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof'));
-- +goose StatementEnd
