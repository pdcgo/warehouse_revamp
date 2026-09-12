-- +goose Up
-- +goose StatementBegin
-- #39: a warehouse carries a physical location / address, editable alongside its hours.
ALTER TABLE warehouse_infos ADD COLUMN location TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE warehouse_infos DROP COLUMN location;
-- +goose StatementEnd
