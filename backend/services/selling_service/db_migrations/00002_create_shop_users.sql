-- +goose Up
-- +goose StatementBegin
-- Shop access (#86): which users may work on a shop. A grant is one (shop, user) pair.
CREATE TABLE shop_users (
    id         BIGSERIAL   PRIMARY KEY,
    shop_id    BIGINT      NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
    -- Opaque user_service id — no FK across the service boundary.
    user_id    BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT shop_users_unique UNIQUE (shop_id, user_id)
);

CREATE INDEX shop_users_shop_idx ON shop_users (shop_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE shop_users;
-- +goose StatementEnd
