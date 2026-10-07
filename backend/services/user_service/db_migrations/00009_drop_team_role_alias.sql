-- +goose Up
-- The per-team alias is gone (a-user-is-name-username-email-phone-and-photo): a person is their name and username in
-- every team, and nothing read the alias. Its four proto fields are reserved.
ALTER TABLE user_team_roles DROP COLUMN alias;

-- +goose Down
-- Back as an empty column — the aliases themselves are not restored.
ALTER TABLE user_team_roles ADD COLUMN alias TEXT NOT NULL DEFAULT '';
