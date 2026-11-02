package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// The team code product_service composes every product code from (the-field-is-product-code-composed-on-write) is read
// from team_service's TeamByIds — a known team answers its code, an unknown or deleted one answers "", which
// product_service refuses on.
func TestProductTeamCodes_ReadsTheCodeFromTeamService(t *testing.T) {
	db := san_testdb.DB(t)

	live := team_service_models.Team{Type: "selling", Name: "Toko Kode", TeamCode: "PTC"}
	gone := team_service_models.Team{Type: "selling", Name: "Toko Hilang", TeamCode: "PTX", Deleted: true}

	for _, team := range []*team_service_models.Team{&live, &gone} {
		err := db.Create(team).Error
		if err != nil {
			t.Fatalf("seed team: %v", err)
		}
	}

	mux := http.NewServeMux()
	mux.Handle(teamv1connect.NewTeamServiceHandler(team_v1.NewService(db, nil)))

	srv := httptest.NewServer(mux)
	defer srv.Close()

	codes := &productTeamCodes{teams: teamv1connect.NewTeamServiceClient(http.DefaultClient, srv.URL)}

	for _, c := range []struct {
		teamID uint64
		want   string
	}{
		{live.ID, "PTC"},
		{gone.ID, ""},
		{999_999, ""},
	} {
		got, err := codes.TeamCode(context.Background(), c.teamID)
		if err != nil {
			t.Fatalf("TeamCode(%d): %v", c.teamID, err)
		}

		if got != c.want {
			t.Fatalf("TeamCode(%d) = %q, want %q", c.teamID, got, c.want)
		}
	}
}
