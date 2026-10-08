package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The figures of a ranked page, over the same window and team. An id with nothing in the window is an all-zero metric,
// never a missing key — the screen draws a row for every id it was handed.
func TestAnalyticGroupMetric_EveryIdGetsAMetric(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 31, "2026-10-01", line{product: 100, ordered: 10, total: 10000, accepted: 9, lost: 1}))
	fold(t, svc, accept(2, sellingB, 31, "2026-10-02", line{product: 900, ordered: 2, total: 2000, accepted: 2}))
	fold(t, svc, accept(3, sellingA, 31, "2026-11-01", line{product: 100, ordered: 5, total: 5000, accepted: 5}))

	metrics := func(team uint64) map[uint64]*supplierv1.SupplierMetric {
		resp, err := svc.AnalyticGroupMetric(context.Background(), connect.NewRequest(&supplierv1.AnalyticGroupMetricRequest{
			TeamId: sellingA,
			Filter: &supplierv1.AnalyticGroupFilter{DateRange: dateRange("2026-10-01", "2026-10-31"), RestockTeamId: team},
			Ids:    []uint64{31, 77},
		}))
		if err != nil {
			t.Fatalf("AnalyticGroupMetric: %v", err)
		}

		return resp.Msg.GetMetrics()
	}

	every := metrics(0)

	if want := metric(11, 11000, 1, 1000, 0, 0); !proto.Equal(every[31], want) {
		t.Fatalf("supplier 31 in October = %v, want %v — November leaked in, or a team was left out", every[31], want)
	}

	if want := metric(0, 0, 0, 0, 0, 0); !proto.Equal(every[77], want) {
		t.Fatalf("supplier 77 = %v, want an all-zero metric", every[77])
	}

	if want := metric(9, 9000, 1, 1000, 0, 0); !proto.Equal(metrics(sellingA)[31], want) {
		t.Fatalf("team A alone = %v, want %v", metrics(sellingA)[31], want)
	}
}
