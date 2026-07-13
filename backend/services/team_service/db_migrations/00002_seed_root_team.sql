-- +goose Up
-- +goose StatementBegin
-- Team 1 is the super-admin scope the access interceptor hardcodes (san_auth.RootTeamID).
-- It is seeded HERE, by the service that OWNS the table.
--
-- ORDERING CONTRACT: team_service migrations must run BEFORE user_service's root-user seed —
-- user_team_roles(team_id=1, user_id=1, ROLE_ROOT) is meaningless until this row exists. There
-- is no FK across the service boundary to enforce it.
INSERT INTO teams (id, type, name, team_code, description)
VALUES (1, 'root', 'Root Team', 'ROOT', 'System root team - the global super-admin scope')
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_infos (team_id)
VALUES (1)
ON CONFLICT (team_id) DO NOTHING;

-- LOAD-BEARING, AND EASY TO MISS.
-- An explicit-id INSERT does NOT advance a BIGSERIAL sequence. Without this the sequence is
-- still at 1, so the FIRST REAL TeamCreate is handed id 1 and dies on a duplicate key.
SELECT setval(pg_get_serial_sequence('teams', 'id'), (SELECT MAX(id) FROM teams));
SELECT setval(pg_get_serial_sequence('team_infos', 'id'), (SELECT MAX(id) FROM team_infos));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM teams WHERE id = 1;   -- team_infos cascades
SELECT setval(pg_get_serial_sequence('teams', 'id'), COALESCE((SELECT MAX(id) FROM teams), 1));
-- +goose StatementEnd
