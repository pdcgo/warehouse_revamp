-- +goose Up
-- +goose StatementBegin
-- The resource_type CHECK must list every value resourceTypeToText() can produce, or an upload of
-- a newly-added type fails at INSERT with "violates check constraint". #60 added product_image (a
-- product catalogue image); allow it here. (Adding a resource type means touching the proto enum,
-- resourceTypeToText/FromText, isPublic, AND this constraint — they must stay in sync.)
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture'));
-- +goose StatementEnd
