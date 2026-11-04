-- +goose Up
-- +goose StatementBegin
-- THE PERSON REPORT CARRIES ITS LAST DAY (docs/business/settlement/context_decision.md
-- #the-person-list-reads-the-last-day-from-the-user-report): the newest report day the person has a row on, so
-- SettlementPersonList reads one row per (user, team) instead of aggregating every daily row of the team.
--
-- It is the MAX of the scope's `user_settlement_daily_reports.day` — never the fold's wall-clock time, which a replay
-- or a late import would reshuffle. The fold raises it (GREATEST) in the same statement that re-derives close_balance;
-- a replay recomputes it for the rows it cut back.
--
-- NULL means the scope has no daily row at all just now — only between a replay's delete and its redelivery, for a
-- person whose every day was inside the replayed range. Such a person is on no figure, so the list skips them.
ALTER TABLE user_settlement_reports ADD COLUMN last_day DATE;

-- THE BACKFILL, from the daily table the fold has always written beside this one.
UPDATE user_settlement_reports u
SET last_day = d.last_day
FROM (
    SELECT user_id, team_id, MAX(day) AS last_day
    FROM user_settlement_daily_reports
    GROUP BY user_id, team_id
) d
WHERE d.user_id = u.user_id
  AND d.team_id = u.team_id;

-- The picker's page: WHERE team_id = ? AND user_id <> 0 ORDER BY last_day DESC, user_id DESC — read backwards for
-- DESC, forwards for ASC. Its team_id prefix serves every lookup the old team index did, so that one goes.
CREATE INDEX user_settlement_reports_team_last_day_idx ON user_settlement_reports (team_id, last_day, user_id);
DROP INDEX user_settlement_reports_team_idx;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE INDEX user_settlement_reports_team_idx ON user_settlement_reports (team_id);
DROP INDEX user_settlement_reports_team_last_day_idx;
ALTER TABLE user_settlement_reports DROP COLUMN last_day;
-- +goose StatementEnd
