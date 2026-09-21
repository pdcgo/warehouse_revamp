package san_perf_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

func seed(n int) []team_service_models.Team {
	rows := make([]team_service_models.Team, 0, n)

	for i := range n {
		rows = append(rows, team_service_models.Team{
			Type:     "warehouse",
			Name:     fmt.Sprintf("perf team %d", i),
			TeamCode: fmt.Sprintf("PERF%06d", i),
		})
	}

	return rows
}

// The probe must see the handler's queries and NOTHING else — not the seed, not the EXPLAIN.
func TestProbeRecordsOnlyTheMeasuredCall(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	san_perf.SeedRows(t, db, seed(500))

	if probe.Count() != 0 {
		t.Fatalf("seed leaked into the probe: %d queries", probe.Count())
	}

	var teams []team_service_models.Team

	wall, dbTime := probe.Measure(func() {
		err := db.
			Where("team_code LIKE ?", "PERF%").
			Limit(50).
			Find(&teams).
			Error
		if err != nil {
			t.Fatalf("find: %v", err)
		}
	})

	if probe.Count() != 1 {
		t.Errorf("Count = %d, want 1", probe.Count())
	}

	if len(teams) != 50 {
		t.Errorf("rows = %d, want 50", len(teams))
	}

	if dbTime <= 0 || dbTime > wall {
		t.Errorf("db=%v wall=%v: db time must be positive and within the wall time", dbTime, wall)
	}

	q := probe.Queries()[0]
	if !strings.Contains(q.SQL, "PERF%") {
		t.Errorf("SQL was not interpolated, so it cannot be EXPLAINed: %s", q.SQL)
	}

	// The plan must come from the SAME transaction: the 500 seeded rows are uncommitted, so any
	// other connection would plan against an empty table.
	plan := san_perf.Explain(t, db, q.SQL)
	if !strings.Contains(plan, "actual time") {
		t.Errorf("plan is not an ANALYZE run: %s", plan)
	}

	if probe.Count() != 1 {
		t.Errorf("Explain leaked into the probe: %d queries", probe.Count())
	}
}

// An N+1 must be visible as a query count that moves with the row count.
func TestProbeSeesNPlusOne(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	san_perf.SeedRows(t, db, seed(100))

	var ids []uint64

	err := db.
		Model(&team_service_models.Team{}).
		Where("team_code LIKE ?", "PERF%").
		Limit(20).
		Pluck("id", &ids).
		Error
	if err != nil {
		t.Fatalf("pluck: %v", err)
	}

	probe.Reset()

	for _, id := range ids {
		var one team_service_models.Team

		err = db.Where("id = ?", id).Find(&one).Error
		if err != nil {
			t.Fatalf("find one: %v", err)
		}
	}

	if probe.Count() != len(ids) {
		t.Errorf("Count = %d, want %d — the probe is not seeing each round-trip", probe.Count(), len(ids))
	}

	probe.Report(t, "n+1 sample")
}
