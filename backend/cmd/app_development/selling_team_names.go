package main

import (
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// NewSellingTeamNamer answers selling's TeamNamer — the warehouse a refused return accept names
// (only-the-return-warehouse-accepts-a-return: "this return goes to Gudang C") — with the same in-process TeamByIds reader
// liability's creditor names use (liabilityTeamNames): the accept has run its own policy, and TeamByIds is an unscoped,
// any-authenticated read. selling never reads `teams`.
func NewSellingTeamNamer(teams *team_v1.Service) selling_v1.TeamNamer {
	return &liabilityTeamNames{teams: teams}
}
