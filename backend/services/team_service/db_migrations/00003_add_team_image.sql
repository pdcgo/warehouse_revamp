-- +goose Up
-- +goose StatementBegin
ALTER TABLE teams ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE teams DROP COLUMN image_url;
-- +goose StatementEnd
