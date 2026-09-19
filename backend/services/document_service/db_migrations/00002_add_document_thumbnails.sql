-- +goose Up
-- +goose StatementBegin
-- Thumbnails for image documents, generated on ConfirmUpload. thumbnail_key is the storage path;
-- thumbnail_url is the stable public URL (set for public image types only).
ALTER TABLE documents ADD COLUMN thumbnail_key TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN thumbnail_url TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP COLUMN thumbnail_url;
ALTER TABLE documents DROP COLUMN thumbnail_key;
-- +goose StatementEnd
