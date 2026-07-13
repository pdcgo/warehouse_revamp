-- +goose Up
-- +goose StatementBegin
CREATE TABLE users (
    id                  BIGSERIAL   PRIMARY KEY,
    name                TEXT        NOT NULL DEFAULT '',
    username            TEXT        NOT NULL,
    -- bcrypt hash. NEVER plaintext. An EMPTY string is a deliberate "cannot log in" marker:
    -- bcrypt comparison against '' always fails, so a seeded account is unusable until someone
    -- sets a password.
    password            TEXT        NOT NULL DEFAULT '',
    email               TEXT        NOT NULL,
    phone_number        TEXT        NOT NULL DEFAULT '',
    is_suspended        BOOLEAN     NOT NULL DEFAULT FALSE,
    last_password_reset TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_username_present CHECK (username <> '')
);

CREATE UNIQUE INDEX users_username_unique ON users (LOWER(username));
CREATE UNIQUE INDEX users_email_unique    ON users (LOWER(email)) WHERE email <> '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE users;
-- +goose StatementEnd
