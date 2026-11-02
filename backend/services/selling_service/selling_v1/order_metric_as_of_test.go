package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// AS OF WHEN (a-money-metric-says-as-of-when): every MetricData answer carries when the fold last claimed an event.
func TestOrderMetricData_SaysAsOfWhen(t *testing.T) {
	db := san_testdb.DB(t)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})

	asOf := func() int64 {
		res, err := analytic.MetricData(context.Background(), connect.NewRequest(&sellingv1.MetricDataRequest{
			TeamId: 2, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: october(), MetricIds: []string{metricCreated},
		}))
		if err != nil {
			t.Fatalf("MetricData: %v", err)
		}

		return res.Msg.GetAsOfUnix()
	}

	// Nothing folded yet: 0, never a made-up "now".
	if asOf := asOf(); asOf != 0 {
		t.Fatalf("as of = %d before the first claim, want 0", asOf)
	}

	// Two claims, the newer one inserted FIRST — as of is the newest, not the last written.
	for _, c := range []struct{ id, at string }{
		{"as-of-newer", "2026-11-02 14:04:00+07"},
		{"as-of-older", "2026-11-02 09:30:00+07"},
	} {
		err := db.Exec(`INSERT INTO order_event_logs (id, raw, day, created_at) VALUES (?, ''::bytea, '2026-10-03', ?)`, c.id, c.at).Error
		if err != nil {
			t.Fatalf("claim %s: %v", c.id, err)
		}
	}

	want := time.Date(2026, 11, 2, 14, 4, 0, 0, time.FixedZone("WIB", 7*60*60)).Unix()
	if asOf := asOf(); asOf != want {
		t.Fatalf("as of = %d, want %d — the newest claim, 14:04 WIB", asOf, want)
	}
}
