-- +goose Up
-- +goose StatementBegin
-- AN UPLOAD BY ROOT OR THE ADMINISTRATOR, in a team they hold no role in, says so
-- (an-override-is-stamped-in-every-service). An import is a server stream; its handler reads the scope and the caller's
-- role from the interceptor's StreamScope, filled when the stream's one request is authorized.
ALTER TABLE uploaded_files ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE uploaded_files DROP COLUMN is_override;
-- +goose StatementEnd
