package team_v1_test

import (
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// newService builds a Service against the test tx. userClient is nil — every handler tested here
// except TeamCreate's saga is pure DB and never calls it.
func newService(db *gorm.DB) *team_v1.Service {
	return team_v1.NewService(db, nil)
}

// newTeam inserts a team directly (bypassing the TeamCreate saga, which needs a live
// user_service) and returns its id.
func newTeam(t *testing.T, db *gorm.DB, teamType, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: teamType, Name: "Test Team", TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatalf("insert team: %v", err)
	}

	return team.ID
}
