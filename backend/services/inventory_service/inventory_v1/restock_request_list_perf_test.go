//go:build perfaudit

package inventory_v1_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

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
//
// The COURIER filter (the-restock-list-exports-and-filters-by-courier): every restock names one of seven couriers
// (every seventh none), and the list narrows by `shipment_id = ?` inside the team's scope with no index of its own —
// measured on a selling team's 10 000, a warehouse's ~16 700, and laid over a status tab and an Arrived window
// (arrived_at, no index either: the Tiba date read since this slice).
func TestPerf_RestockRequestList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	restocks := make([]inventory_service_models.Restock, 0, 50_000)

	for i := range 50_000 {
		team := uint64(2 + i%5)
		created := now.Add(-time.Duration(50_000-i) * time.Minute)
		arrived := created.Add(time.Hour)
		restocks = append(restocks, inventory_service_models.Restock{
			TeamID:          team,
			WarehouseID:     uint64(900 + i%3),
			Status:          "accepted",
			ShipmentID:      []uint64{0, 91, 92, 93, 94, 95, 96}[i%7],
			CreatedByUserID: 1000*team + uint64(i%40),
			CreatedAt:       created,
			ArrivedAt:       &arrived,
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
		{"selling, courier, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Filter: &inventoryv1.RestockRequestListFilter{ShipmentId: 93}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, courier, page 50 of 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Filter: &inventoryv1.RestockRequestListFilter{ShipmentId: 93}, Page: &commonv1.CommonPagination{Page: 50, Limit: 20}}},
		{"warehouse, courier, 20", &inventoryv1.RestockRequestListRequest{TeamId: 900, Filter: &inventoryv1.RestockRequestListFilter{ShipmentId: 93}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, courier + accepted tab, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Filter: &inventoryv1.RestockRequestListFilter{
			ShipmentId: 93, Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
		}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, courier + arrived 7 days, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Filter: &inventoryv1.RestockRequestListFilter{
			ShipmentId: 93, DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ARRIVED,
			FromUnix: now.AddDate(0, 0, -7).Unix(), ToUnix: now.Unix(),
		}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, arrived 7 days, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Filter: &inventoryv1.RestockRequestListFilter{
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ARRIVED,
			FromUnix:  now.AddDate(0, 0, -7).Unix(), ToUnix: now.Unix(),
		}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
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

		t.Logf("%s MEDIAN wall %v, total %d, of %d rows badged: created %d, arrived %d, accepted %d",
			c.name, san_perf.Median(walls), res.Msg.GetPageInfo().GetTotalItems(), len(res.Msg.GetIds()), created, arrived, accepted)

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

// perfProblemBook seeds the book the lists' problem counts are read over (backlog #89): 50 000 restocks — five selling
// teams of 10 000 into three warehouses — four in five accepted, each with three lines (150 000 `restock_items`) and a
// trail of two rows (the create, the accept). One accepted restock in four came short on its first line, one in six
// had broken units on its second: ≈ 16 700 `restock_problem_items`. Returns the restocks, ids filled.
func perfProblemBook(t *testing.T, db *gorm.DB) []inventory_service_models.Restock {
	t.Helper()

	now := time.Now()
	restocks := make([]inventory_service_models.Restock, 0, 50_000)

	for i := range 50_000 {
		team := uint64(2 + i%5)
		created := now.Add(-time.Duration(50_000-i) * time.Minute)
		status := "accepted"

		switch i % 10 {
		case 3:
			status = "ongoing"
		case 7:
			status = "arrived"
		}

		restocks = append(restocks, inventory_service_models.Restock{
			TeamID:          team,
			WarehouseID:     uint64(900 + i%3),
			Status:          status,
			CreatedByUserID: 1000*team + uint64(i%40),
			CreatedAt:       created,
			UpdatedAt:       now,
		})
	}

	san_perf.SeedRows(t, db, &restocks)

	items := make([]inventory_service_models.RestockItem, 0, 3*len(restocks))
	logs := make([]inventory_service_models.RestockLog, 0, 2*len(restocks))
	problems := make([]inventory_service_models.RestockProblemItem, 0, 20_000)

	for i, r := range restocks {
		for k := range 3 {
			product := 10_000*r.TeamID + uint64((i*3+k)%900)
			items = append(items, inventory_service_models.RestockItem{
				RestockID: r.ID, ProductID: product, ProductCode: "P-" + strconv.FormatUint(product, 10), Name: "Produk",
				Count: 10, Total: 100_000, PriceUnit: 10_000, ReceivedCount: 10, CreatedAt: r.CreatedAt, UpdatedAt: now,
			})
		}

		logs = append(logs,
			inventory_service_models.RestockLog{RestockID: r.ID, ToStatus: "ongoing", ActorUserID: r.CreatedByUserID, Description: "created", CreatedAt: r.CreatedAt},
			inventory_service_models.RestockLog{RestockID: r.ID, FromStatus: "ongoing", ToStatus: r.Status, ActorUserID: 5000, Description: "moved", CreatedAt: r.CreatedAt.Add(time.Hour)},
		)

		if r.Status != "accepted" {
			continue
		}

		if i%4 == 0 {
			problems = append(problems, inventory_service_models.RestockProblemItem{
				RestockID: r.ID, ProductID: items[len(items)-3].ProductID, ProblemType: "missing", Count: int64(1 + i%3),
				PriceUnit: 10_000, Total: float64(10_000 * (1 + i%3)), CreatedAt: r.CreatedAt,
			})
		}

		if i%6 == 0 {
			problems = append(problems, inventory_service_models.RestockProblemItem{
				RestockID: r.ID, ProductID: items[len(items)-2].ProductID, ProblemType: "broken", Count: 2,
				PriceUnit: 10_000, Total: 20_000, CreatedAt: r.CreatedAt,
			})
		}
	}

	san_perf.SeedRows(t, db, &items)
	san_perf.SeedRows(t, db, &logs)
	san_perf.SeedRows(t, db, &problems)

	t.Logf("seeded %d restocks, %d lines, %d trail rows, %d problem rows", len(restocks), len(items), len(logs), len(problems))

	return restocks
}

// perfProblemCases are the list pages the problem counts are measured on: both sides, a small and a large page, a deep
// page, and the Accepted tab (every row on it can carry counts).
func perfProblemCases() []struct {
	name string
	req  *inventoryv1.RestockRequestListRequest
} {
	accepted := &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED}

	return []struct {
		name string
		req  *inventoryv1.RestockRequestListRequest
	}{
		{"selling, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, 200", &inventoryv1.RestockRequestListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}}},
		{"selling, page 100 of 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 100, Limit: 20}}},
		{"selling, accepted tab, 20", &inventoryv1.RestockRequestListRequest{TeamId: 2, Filter: accepted, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"warehouse, 20", &inventoryv1.RestockRequestListRequest{TeamId: 900, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"warehouse, 200", &inventoryv1.RestockRequestListRequest{TeamId: 900, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}}},
	}
}

// THE PROBLEM COUNTS ON THE LISTS (backlog #89, the-restock-tags-prototype-is-accepted: *on accepted rows kurang N ·
// rusak N*): ONE grouped statement per page over the page's accepted restocks, by `restock_problem_items_one_per_kind`
// (restock_id, product_id, problem_type) — whatever the page size or depth. Logs each case's median wall, its query
// count, how many rows came with a count, and the plan of the new statement.
func TestPerf_RestockRequestListProblemCounts(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfProblemBook(t, db)

	svc := newService(t, db)
	ctx := ctxUser(7)

	for _, c := range perfProblemCases() {
		res, err := svc.RestockRequestList(ctx, connect.NewRequest(c.req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		counted := 0

		for _, item := range res.Msg.GetItems() {
			for _, r := range item.GetRestockRequest().GetMapData() {
				for _, line := range r.GetItems() {
					if len(line.GetProblems()) > 0 {
						counted++

						break
					}
				}
			}
		}

		walls := make([]time.Duration, 0, 5)
		queries := 0

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() {
				_, err = svc.RestockRequestList(ctx, connect.NewRequest(c.req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			queries = probe.Count()
		}

		t.Logf("%s MEDIAN wall %v, %d queries, %d of %d rows with a count", c.name, san_perf.Median(walls), queries, counted, len(res.Msg.GetIds()))

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "restock_problem_items") {
				t.Logf("%s — the problem counts, %v:", c.name, q.Duration)
				san_perf.Explain(t, db, q.SQL)
			}
		}
	}
}
