package expense_v1

import "context"

// TeamSide is which side of the Analytic composer a team's expenses sit on (the-warehouse-is-its-own-group): a selling
// team's under Seller (GROUP_TYPE_TEAM), a warehouse team's under Warehouse (GROUP_TYPE_WAREHOUSE). The root and admin
// teams sit on neither.
type TeamSide int

const (
	SideNeither TeamSide = iota
	SideSeller
	SideWarehouse
)

// TeamSides answers, for an expense being recorded or corrected, which side its team sits on. team_service owns a
// team's type; expense_service never reads its tables. The composition root adapts this (a team's type never changes,
// a-team-has-exactly-one-type, so an answer may be kept).
type TeamSides interface {
	SideOf(ctx context.Context, teamID uint64) (TeamSide, error)
}

// everyTeamSells answers Seller for every team — the default with no team service wired (a unit test of a selling
// team's expenses). The app always wires the real one.
type everyTeamSells struct{}

func (everyTeamSells) SideOf(context.Context, uint64) (TeamSide, error) {
	return SideSeller, nil
}
