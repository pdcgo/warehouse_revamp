//go:build perfaudit

package inventory_v1_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// 50 000 restocks — five selling teams of 10 000 into three warehouses — each with a trail of four rows (the create,
// signed for, counted in, one edit): 200 000 `restock_logs`. One in fifty was raised by Root from outside, one in seventy
// signed for by Root, one in ninety counted in by Root. The lists' by-line badges (`created_by_is_override`,
// `arrived_by_is_override`, `accepted_by_is_override`) are ONE extra query per page — a GROUP BY over the page's trail
// rows, by `restock_logs_restock_idx` (restock_id, created_at, id) — whatever the page size or depth. The previous
// created-only lookup (DISTINCT ON) is EXPLAINed over the same page as the control.
func TestPerf_RestockRequestList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	restocks := make([]inventory_service_models.Restock, 0, 50_000)

	for i := range 50_000 {
		team := uint64(2 + i%5)
		restocks = append(restocks, inventory_service_models.Restock{
			TeamID:          team,
			WarehouseID:     uint64(900 + i%3),
			Status:          "accepted",
			CreatedByUserID: 1000*team + uint64(i%40),
			CreatedAt:       now.Add(-time.Duration(50_000-i) * time.Minute),
			UpdatedAt:       now,
		})
	}

	san_perf.SeedRows(t, db, &restocks)

	logs := make([]inventory_service_models.RestockLog, 0, 4*len(restocks))

	for i, r := range restocks {
		at := r.CreatedAt
		logs = append(logs,
			inventory_service_models.RestockLog{RestockID: r.ID, ToStatus: "ongoing", ActorUserID: r.CreatedByUserID, IsOverride: i%50 == 0, Description: "created", CreatedAt: at},
			inventory_service_models.RestockLog{RestockID: r.ID, FromStatus: "ongoing", ToStatus: "ongoing", ActorUserID: r.CreatedByUserID, Description: "edited", CreatedAt: at.Add(10 * time.Minute)},
			inventory_service_models.RestockLog{RestockID: r.ID, FromStatus: "ongoing", ToStatus: "arrived", ActorUserID: 5000, IsOverride: i%70 == 0, Description: "signed for the box", CreatedAt: at.Add(time.Hour)},
			inventory_service_models.RestockLog{RestockID: r.ID, FromStatus: "arrived", ToStatus: "accepted", ActorUserID: 5000, IsOverride: i%90 == 0, Description: "accepted", CreatedAt: at.Add(2 * time.Hour)},
		)
	}

	san_perf.SeedRows(t, db, &logs)

	svc := newService(t, db)
	ctx := ctxUser(7)

	cases := []struct {
		name string
		req  *inventoryv1.RestockRequestListRequest
	}{
		{"selling, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, 200", &inventoryv1.RestockRequestListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}}},
		{"selling, page 100 of 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 100, Limit: 20}}},
		{"warehouse, 20", &inventoryv1.RestockRequestListRequest{TeamId: 900, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
	}

	for _, c := range cases {
		res, err := svc.RestockRequestList(ctx, connect.NewRequest(c.req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		created, arrived, accepted := 0, 0, 0

		for _, item := range res.Msg.GetItems() {
			for _, r := range item.GetRestockRequest().GetMapData() {
				if r.GetCreatedByIsOverride() {
					created++
				}

				if r.GetArrivedByIsOverride() {
					arrived++
				}

				if r.GetAcceptedByIsOverride() {
					accepted++
				}
			}
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.RestockRequestList(ctx, connect.NewRequest(c.req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v, of %d rows badged: created %d, arrived %d, accepted %d",
			c.name, san_perf.Median(walls), len(res.Msg.GetIds()), created, arrived, accepted)

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			if strings.Contains(q.SQL, "restock_logs") {
				t.Logf("%s — the by-line lookup, %v:", c.name, q.Duration)
			}

			san_perf.Explain(t, db, q.SQL)
		}

		// THE CONTROL: the created-only lookup this one replaced, over the same page.
		ids := make([]string, 0, len(res.Msg.GetIds()))
		for _, id := range res.Msg.GetIds() {
			ids = append(ids, strconv.FormatUint(id, 10))
		}

		t.Logf("%s — the previous created-only lookup (control):", c.name)
		san_perf.Explain(t, db, "SELECT DISTINCT ON (restock_id) restock_id, is_override FROM restock_logs WHERE restock_id IN ("+
			strings.Join(ids, ",")+") ORDER BY restock_id, created_at, id")
	}
}
