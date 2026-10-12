//go:build perfaudit

package team_v1

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// The performance audit of TeamCreate once it grants the NAMED Owner (audit-rpc-performance). team_service's
// own share only: the grant is user_service's TeamUserUpdate, measured in member_grants_perf_test.go, and is
// faked here so the numbers are this service's.
//
// Volume: 10 000 teams (an entity table) — the unique team_code index is what every insert checks.
func TestPerf_TeamCreate(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"TeamCreate", nil},
		// A refused Owner: the team is inserted, then hard-deleted so its code is free.
		{"TeamCreate (refused Owner)", connect.NewError(connect.CodeNotFound, errors.New("user not found"))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, probe := san_perf.Wrap(san_testdb.DB(t))

			teams := make([]team_service_models.Team, 10_000)
			for i := range teams {
				teams[i] = team_service_models.Team{Type: "selling", Name: fmt.Sprintf("Perf %d", i), TeamCode: fmt.Sprintf("PF%d", i)}
			}
			san_perf.SeedRows(t, db, &teams)

			s := NewService(db, &fakeGrants{err: tc.err})
			ctx := context.Background()

			call := func(i int) {
				_, err := s.TeamCreate(ctx, createRequest(fmt.Sprintf("NEW%d", i+1), 57))
				if connect.CodeOf(err) != connect.CodeOf(tc.err) {
					t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeOf(tc.err))
				}
			}

			call(-1) // warm-up: schema reflection, the pool

			walls := make([]time.Duration, 0, 5)

			for i := range 5 {
				probe.Reset()

				wall, dbTime := probe.Measure(func() { call(i) })

				walls = append(walls, wall)
				t.Logf("%s wall=%v db=%v go=%v queries=%d", tc.name, wall, dbTime, wall-dbTime, probe.Count())
			}

			t.Logf("%s median wall %v", tc.name, san_perf.Median(walls))
			probe.Report(t, tc.name)
		})
	}
}
