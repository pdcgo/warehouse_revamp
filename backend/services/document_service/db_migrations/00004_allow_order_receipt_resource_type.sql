-- +goose Up
-- +goose StatementBegin
-- An order can carry its SHIPPING RECEIPT (owner) — a photo of the courier's slip or the PDF the
-- marketplace prints. It is a named resource type rather than a `general` document so the documents
-- table says what the file is; it is PRIVATE, so it is read through a short-lived signed URL.
--
-- The CHECK must list every value resourceTypeToText() can produce, or an upload of a newly-added
-- type fails at INSERT. (Adding a resource type means touching the proto enum, resourceTypeToText/
-- FromText, isPublic, AND this constraint — they must stay in sync.)
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image'));
-- +goose StatementEnd
