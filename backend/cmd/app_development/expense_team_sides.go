package main

import (
	"context"
	"sync"

	"gorm.io/gorm"

	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// expenseTeamSides answers expense's TeamSides — is the team an expense belongs to a seller or a warehouse — so the
// Analytic report keeps a selling team's expenses under Seller and a warehouse team's under Warehouse
// (the-warehouse-is-its-own-group, the-expense-metrics-follow-the-decisions-already-made). A local read of team_service's
// `teams.type`, as teamKinds reads it for the interceptor; expense_service never reads that table.
//
// A team's type never changes (a-team-has-exactly-one-type), so an answer is kept for the life of the process: asked once
// per team, before the expense's transaction, never under it.
type expenseTeamSides struct {
	db    *gorm.DB
	known sync.Map // team id → expense_v1.TeamSide
}

func NewExpenseTeamSides(db *gorm.DB) expense_v1.TeamSides {
	return &expenseTeamSides{db: db}
}

func (s *expenseTeamSides) SideOf(ctx context.Context, teamID uint64) (expense_v1.TeamSide, error) {
	if known, ok := s.known.Load(teamID); ok {
		return known.(expense_v1.TeamSide), nil
	}

	var types []string

	err := s.db.WithContext(ctx).
		Table("teams").
		Where("id = ?", teamID).
		Limit(1).
		Pluck("type", &types).
		Error
	if err != nil {
		return expense_v1.SideNeither, err
	}

	// An unknown team sits on neither side, and is not remembered — it may be created a moment later.
	if len(types) == 0 {
		return expense_v1.SideNeither, nil
	}

	side := expense_v1.SideNeither

	switch types[0] {
	case "selling":
		side = expense_v1.SideSeller
	case "warehouse":
		side = expense_v1.SideWarehouse
	}

	s.known.Store(teamID, side)

	return side, nil
}
