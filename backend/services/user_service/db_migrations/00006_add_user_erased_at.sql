-- +goose Up
-- +goose StatementBegin

-- an-erased-account-is-final: the account SAYS it was erased, rather than being recognised by its name. Set once, by
-- UserErase, and never cleared — once set, the account is never unsuspended, given a password, added to a team or
-- edited. NULL for every account that is not erased.
ALTER TABLE users ADD COLUMN erased_at TIMESTAMPTZ;

-- An erased account is suspended for good: the column cannot be set on an account that is not.
ALTER TABLE users ADD CONSTRAINT users_erased_is_suspended CHECK (erased_at IS NULL OR is_suspended);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP CONSTRAINT users_erased_is_suspended;
ALTER TABLE users DROP COLUMN erased_at;
-- +goose StatementEnd
