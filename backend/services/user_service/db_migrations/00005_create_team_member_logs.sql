-- +goose Up
-- +goose StatementBegin

-- THE MEMBERSHIP LOG (every-role-change-is-logged): one row per add, role change and removal, written in the SAME
-- transaction as the change it records, so a membership can never change without its row. Append-only — never
-- updated, never deleted. user_team_roles holds what IS; this holds how it got there.
CREATE TABLE team_member_logs (
    id            BIGSERIAL   PRIMARY KEY,

    -- No foreign key: teams belong to team_service (see user_team_roles).
    team_id       BIGINT      NOT NULL,

    -- Who did it: a person, or — for a developer acting through tools/san — an agent name with no person.
    actor_user_id BIGINT      REFERENCES users (id),
    actor_agent   TEXT        NOT NULL DEFAULT '',

    -- Whose membership changed. A user is never deleted (a-user-is-never-deleted), so this always resolves.
    user_id       BIGINT      NOT NULL REFERENCES users (id),

    -- warehouse.user.v1.TeamMemberLogAction: 1 add, 2 change role, 3 remove.
    action        SMALLINT    NOT NULL,

    -- The raw warehouse.role_base.v1.Role numbers, as in user_team_roles. 0 before an add, and after a removal.
    role_before   BIGINT      NOT NULL DEFAULT 0,
    role_after    BIGINT      NOT NULL DEFAULT 0,

    -- Root or the Administrator acting in a team they are not a member of (an-override-is-stamped-in-every-service).
    is_override   BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT team_member_logs_action_known CHECK (action IN (1, 2, 3)),
    CONSTRAINT team_member_logs_actor_present CHECK (actor_user_id IS NOT NULL OR actor_agent <> ''),
    -- A row records a CHANGE: an add has nothing before it, a removal nothing after, a role change two roles.
    CONSTRAINT team_member_logs_roles_fit_action CHECK (
        (action = 1 AND role_before = 0 AND role_after <> 0) OR
        (action = 2 AND role_before <> 0 AND role_after <> 0 AND role_before <> role_after) OR
        (action = 3 AND role_before <> 0 AND role_after = 0)
    )
);

-- The member page reads one team's history newest first, and one person's within it. id order IS insert order.
CREATE INDEX team_member_logs_team_idx ON team_member_logs (team_id, id DESC);
CREATE INDEX team_member_logs_team_user_idx ON team_member_logs (team_id, user_id, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE team_member_logs;
-- +goose StatementEnd
