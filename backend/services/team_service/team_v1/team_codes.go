package team_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
)

// THE CODE A TEAM HOLDS, AND THE CODES IT ONCE HELD (backlog #149, a-team-code-change-recomposes-its-product-codes and its
// Q1 "A"). A code is the team's while it is current (teams.team_code, unique over every row, deleted teams too) and stays
// the team's once it has moved on (team_former_codes, keyed by the code): "a team code once used is never given to
// another team", so an old sticker's ABC-… can only ever mean this team's product. TeamCreate and TeamCodeUpdate both
// refuse a code another team holds or held, naming that team; a team may take its OWN former code back.

// codeHolder is the team other than the asking one that holds a code now, or held it once.
type codeHolder struct {
	TeamID uint64
	Name   string
	Former bool
}

// errCodeTaken carries the holder out of a transaction, to be answered as AlreadyExists with a TeamCodeTaken detail.
type errCodeTaken struct {
	code   string
	holder codeHolder
}

func (e *errCodeTaken) Error() string {
	if e.holder.Former {
		return fmt.Sprintf("team_code already exists — %s was %s's code, and a team code once used is never given to another team",
			e.code, e.holder.Name)
	}

	return fmt.Sprintf("team_code already exists — %s is %s's code", e.code, e.holder.Name)
}

// holderOf is the team OTHER than `teamID` (0 = a team still to be created) that holds `code` now or held it once — nil
// when none does. ONE statement, so it reads one snapshot: a team moving off the code in the same instant is either still
// holding it (its update not committed) or already has it among its former codes (committed with the update) — never
// neither. A current holder is named before a former one.
func holderOf(tx *gorm.DB, code string, teamID uint64) (*codeHolder, error) {
	var rows []codeHolder

	err := tx.
		Raw(`SELECT id AS team_id, name, false AS former FROM teams WHERE team_code = ? AND id <> ?
			UNION ALL
			SELECT t.id, t.name, true FROM team_former_codes f JOIN teams t ON t.id = f.team_id
			WHERE f.team_code = ? AND f.team_id <> ?
			ORDER BY former
			LIMIT 1`, code, teamID, code, teamID).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return nil, nil
	}

	return &rows[0], nil
}

// refuseTakenCode is nil when no other team holds or held `code`, else errCodeTaken naming that team.
func refuseTakenCode(tx *gorm.DB, code string, teamID uint64) error {
	holder, err := holderOf(tx, code, teamID)
	if err != nil {
		return err
	}

	if holder != nil {
		return &errCodeTaken{code: code, holder: *holder}
	}

	return nil
}

// codeTakenAnswer is the AlreadyExists a refused code answers, its TeamCodeTaken detail naming the team.
func codeTakenAnswer(taken *errCodeTaken) error {
	out := connect.NewError(connect.CodeAlreadyExists, errors.New(taken.Error()))

	detail, detailErr := connect.NewErrorDetail(&teamv1.TeamCodeTaken{
		TeamCode: taken.code,
		TeamName: taken.holder.Name,
		Former:   taken.holder.Former,
	})
	if detailErr == nil {
		out.AddDetail(detail)
	}

	return out
}

// codeRaceAnswer answers a write that the unique index on teams.team_code refused: another team took the code between
// this write's check and its update (two teams changing to one code at once — the index lets one win). Read AFTER the
// failed transaction, so the winner is committed and can be named; a winner that cannot be read leaves the plain answer.
func (s *Service) codeRaceAnswer(ctx context.Context, code string, teamID uint64) error {
	holder, err := holderOf(s.db.WithContext(ctx), code, teamID)
	if err != nil || holder == nil {
		return connect.NewError(connect.CodeAlreadyExists, errors.New("team_code already exists"))
	}

	return codeTakenAnswer(&errCodeTaken{code: code, holder: *holder})
}

// FormerCodesOf is each team's former codes — the codes it held once and moved on from, oldest first. A plain function
// over this service's own table, for `san product recompose-codes`' guard (tools/san): a product code that begins with
// one of its team's former codes is a code that took a team code once, never a bare part to put the team code in front
// of. A team with none is absent.
func FormerCodesOf(ctx context.Context, db *gorm.DB, teamIDs []uint64) (map[uint64][]string, error) {
	out := map[uint64][]string{}
	if len(teamIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		TeamID   uint64
		TeamCode string
	}

	err := db.
		WithContext(ctx).
		Table("team_former_codes").
		Select("team_id, team_code").
		Where("team_id IN ?", teamIDs).
		Order("team_id, retired_at, team_code").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		out[row.TeamID] = append(out[row.TeamID], row.TeamCode)
	}

	return out, nil
}
