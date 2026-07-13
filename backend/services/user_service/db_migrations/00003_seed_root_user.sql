-- +goose Up
-- +goose StatementBegin
-- The root account. It exists structurally so that ROLE_ROOT in team 1 (the super-admin scope
-- the interceptor hardcodes) always has a holder.
--
-- ⚠ ORDERING CONTRACT: team_service's migrations must have run first — this row's team_id = 1
-- is meaningless until team 1 exists. There is no cross-service FK to enforce that.
--
-- The password is deliberately EMPTY, which bcrypt can never match. The system therefore boots
-- with a root account that CANNOT log in until someone sets its password:
--
--     go run ./cmd/tool seed root --password <secret>
--
-- A hardcoded default password in a migration would ship to production. This cannot.
INSERT INTO users (id, username, email, name, password)
VALUES (1, 'root', 'root@system.local', 'Root', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_team_roles (team_id, user_id, role, alias)
VALUES (1, 1, 1, 'root')   -- role 1 = warehouse.role_base.v1.ROLE_ROOT
ON CONFLICT (team_id, user_id) DO NOTHING;

-- An explicit-id INSERT does not advance the sequence: without this the first real CreateUser
-- is handed id 1 and dies on a duplicate key.
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users));
SELECT setval(pg_get_serial_sequence('user_team_roles', 'id'), (SELECT MAX(id) FROM user_team_roles));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM users WHERE id = 1;   -- user_team_roles cascades
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1));
-- +goose StatementEnd
