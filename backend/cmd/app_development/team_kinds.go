package main

import (
	"context"
	"sync"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// teamKinds answers the interceptor's one question about a team it does not own — is it a warehouse or a selling team,
// the kinds the admin team monitors (the-admin-team-monitors-all-and-manages-its-own). A local read of team_service's
// `teams.type`, as the composition root reads across services; writes go through the owner's RPC.
//
// A team's type never changes (a-team-has-exactly-one-type), so an answer is kept for the life of the process. Asked
// only for a call that is otherwise a monitor's, so a member's call never pays for it.
type teamKinds struct {
	db    *gorm.DB
	known sync.Map // team id → bool
}

func NewTeamKinds(db *gorm.DB) access_interceptors.TeamKinds {
	return &teamKinds{db: db}
}

func (k *teamKinds) Monitorable(ctx context.Context, teamID uint64) (bool, error) {
	if known, ok := k.known.Load(teamID); ok {
		return known.(bool), nil
	}

	var types []string

	err := k.db.WithContext(ctx).
		Table("teams").
		Where("id = ?", teamID).
		Limit(1).
		Pluck("type", &types).
		Error
	if err != nil {
		return false, err
	}

	// An unknown team is not monitored, and not remembered — it may be created a moment later.
	if len(types) == 0 {
		return false, nil
	}

	monitorable := types[0] == "warehouse" || types[0] == "selling"
	k.known.Store(teamID, monitorable)

	return monitorable, nil
}
