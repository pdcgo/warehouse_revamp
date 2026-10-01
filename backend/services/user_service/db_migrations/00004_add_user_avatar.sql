-- +goose Up
-- +goose StatementBegin
-- The profile picture's compact (thumbnail) URL. The image itself lives in document_service; the
-- user row only keeps the display URL.
ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN avatar_url;
-- +goose StatementEnd
