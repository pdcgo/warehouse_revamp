//go:build perfaudit

// go test -tags perfaudit -run TestPerf_StatementLinesBySettlementLogIds -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Shop Entries asks once per page — 20 settlement rows, at most 200 — for the lines naming them. The seed's lines name
// the same log ids across 51 files (a re-import FINDS a row again), so each id has dozens of lines to choose one from.
func TestPerf_StatementLinesBySettlementLogIds(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSeed(t, db)

	w := newWorld(t, db)
	ctx := context.Background()

	ids := func(n int) []uint64 {
		out := make([]uint64, 0, n)
		for i := range n {
			out = append(out, uint64(9_000_100+i))
		}

		return out
	}

	for _, c := range []struct {
		name   string
		teamID uint64
		ids    []uint64
	}{
		{"team ids20", team, ids(20)},
		{"team ids200", team, ids(200)},
		{"root ids20", san_auth.RootTeamID, ids(20)},
	} {
		var got int

		perfRun(t, probe, "StatementLinesBySettlementLogIds/"+c.name, func(int) error {
			lines, err := w.svc.StatementLinesBySettlementLogIds(ctx, c.teamID, c.ids)
			got = len(lines)

			return err
		})

		t.Logf("PERF| StatementLinesBySettlementLogIds/%s answered %d lines", c.name, got)
		perfExplainAll(t, db, probe)
	}
}
