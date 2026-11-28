-- +goose Up
-- +goose StatementBegin

-- THE CODES A TEAM ONCE HELD (backlog #149 — docs/business/product/context_decision.md:
-- a-team-code-change-recomposes-its-product-codes and its Q1 "A"). A selling team's code can now be edited
-- (TeamCodeUpdate), and its products take the new one. The code it moved on from stays TAKEN: "a team code once used is
-- never given to another team", so an old sticker's ABC-SHOE-42 can only ever mean this team's product, and scanning a
-- former code still finds it (#152). TeamCreate and TeamCodeUpdate refuse a code another team holds (teams.team_code) or
-- once held (here), naming that team; the team itself may take its own former code back (its row then leaves this table —
-- the code is current again).
--
--   team_code   the former code — the KEY: a code is a former code of ONE team, and never current anywhere at the same
--               time (the edit moves it from teams to here, or back, in one transaction).
--   team_id     the team that held it. A team is only soft-deleted (a refused TeamCreate's hard delete removes a team
--               that never changed its code), so its former codes stay taken with it.
--   retired_at  when the team moved on from it.
--
-- Nothing to seed: no team code has ever changed before this table.
CREATE TABLE team_former_codes (
    team_code  TEXT        PRIMARY KEY CHECK (team_code <> ''),
    team_id    BIGINT      NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    retired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A team's former codes — `san product recompose-codes`' guard reads them per team.
CREATE INDEX team_former_codes_team_idx ON team_former_codes (team_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE team_former_codes;
-- +goose StatementEnd
