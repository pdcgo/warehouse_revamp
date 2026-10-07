-- +goose Up
-- +goose StatementBegin

-- ProfilePictureErase (erase-deletes-the-photo-file) finds every profile picture one person uploaded. Without this
-- it scans the whole table — every receipt, statement and photo — to return a handful of rows. PARTIAL: only profile
-- pictures, the one kind the query asks about, so the index stays a small fraction of the table.
CREATE INDEX documents_profile_picture_uploader_idx ON documents (created_by_id) WHERE resource_type = 'profile_picture';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX documents_profile_picture_uploader_idx;
-- +goose StatementEnd
