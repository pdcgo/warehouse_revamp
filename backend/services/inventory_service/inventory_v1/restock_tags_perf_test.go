//go:build perfaudit

package inventory_v1_test

import (
	"context"
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
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE TAG FILTER AT VOLUME (backlog #87). 50 000 restocks — five selling teams of 10 000 into three warehouses — with
// ~23 400 `restock_tags`: *Barang kurang* on every 12th, *Barang rusak* on every 20th (the problem list ≈ 5 800),
// *Lebaran 2026* on every 3rd (common), *Retur* on every 500th (rare). The admins' per-tag count (RestockTagManageList)
// and the delete's take-off read `restock_tags` by tag alone — EXPLAINed too. The list narrows by
// `EXISTS (… restock_tags rt WHERE rt.restock_id = restocks.id AND rt.tag_id IN (…))` inside restockListScope, and each
// page reads its tags in one statement. Measured with the migration's `restock_tags_tag_idx` (tag_id, restock_id), then
// with it dropped in this transaction (the before), so the pure index's gain is on record
// (a-pure-index-is-added-without-asking). The selling statistics read the same predicate.
//
//	go test -tags perfaudit -p 1 -count=1 -run TestPerf_RestockTagFilter -v ./backend/services/inventory_service/inventory_v1/
func TestPerf_RestockTagFilter(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	restocks := make([]inventory_service_models.Restock, 0, 50_000)

	for i := range 50_000 {
		restocks = append(restocks, inventory_service_models.Restock{
			TeamID:      uint64(2 + i%5),
			WarehouseID: uint64(900 + i%3),
			Status:      []string{"ongoing", "arrived", "accepted", "accepted", "lost"}[(i/5)%5],
			ShipmentID:  []uint64{0, 91, 92}[i%3],
			CreatedAt:   now.Add(-time.Duration(50_000-i) * time.Minute),
			UpdatedAt:   now,
		})
	}

	san_perf.SeedRows(t, db, &restocks)

	kurang := appTagID(t, db, taskMissing)
	rusak := appTagID(t, db, taskBroken)
	lebaran := seedTag(t, db, "perf-Lebaran 2026", "custom")
	retur := seedTag(t, db, "perf-Retur", "custom")

	tags := make([]inventory_service_models.RestockTag, 0, 32_000)

	for i, r := range restocks {
		for _, on := range []struct {
			every int
			tag   uint64
		}{{12, kurang}, {20, rusak}, {3, lebaran}, {500, retur}} {
			if i%on.every == 0 {
				tags = append(tags, inventory_service_models.RestockTag{RestockID: r.ID, TagID: on.tag, AddedAt: now})
			}
		}
	}

	san_perf.SeedRows(t, db, &tags)
	t.Logf("seeded %d restocks, %d restock_tags", len(restocks), len(tags))

	svc := newService(t, db)
	ctx := ctxUser(7)

	page := func(team uint64, filter *inventoryv1.RestockRequestListFilter, p uint32) *inventoryv1.RestockRequestListRequest {
		return &inventoryv1.RestockRequestListRequest{TeamId: team, Filter: filter, Page: &commonv1.CommonPagination{Page: p, Limit: 20}}
	}

	problems := []uint64{kurang, rusak}

	cases := []struct {
		name string
		req  *inventoryv1.RestockRequestListRequest
	}{
		{"selling, no tag filter", page(2, nil, 1)},
		{"selling, the problem list", page(2, &inventoryv1.RestockRequestListFilter{TagIds: problems}, 1)},
		{"selling, the problem list, page 50", page(2, &inventoryv1.RestockRequestListFilter{TagIds: problems}, 50)},
		{"selling, the problem list + accepted tab", page(2, &inventoryv1.RestockRequestListFilter{
			TagIds: problems, Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
		}, 1)},
		{"selling, a common tag", page(2, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{lebaran}}, 1)},
		{"selling, a rare tag", page(2, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{retur}}, 1)},
		{"warehouse, the problem list", page(900, &inventoryv1.RestockRequestListFilter{TagIds: problems}, 1)},
		{"warehouse, a rare tag", page(900, &inventoryv1.RestockRequestListFilter{TagIds: []uint64{retur}}, 1)},
	}

	run := func(label string) {
		for _, c := range cases {
			res, err := svc.RestockRequestList(ctx, connect.NewRequest(c.req))
			if err != nil {
				t.Fatalf("%s warm-up: %v", c.name, err)
			}

			walls := make([]time.Duration, 0, 5)

			for range 5 {
				probe.Reset()

				wall, _ := probe.Measure(func() {
					_, err = svc.RestockRequestList(ctx, connect.NewRequest(c.req))
				})
				if err != nil {
					t.Fatalf("%s: %v", c.name, err)
				}

				walls = append(walls, wall)
			}

			t.Logf("[%s] %s: MEDIAN wall %v, total %d, %d queries", label, c.name, san_perf.Median(walls),
				res.Msg.GetPageInfo().GetTotalItems(), probe.Count())

			for _, q := range probe.Queries() {
				if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
					continue
				}

				if strings.Contains(q.SQL, "restock_tags") {
					t.Logf("[%s] %s — %v:", label, c.name, q.Duration)
					san_perf.Explain(t, db, q.SQL)
				}
			}
		}

		perfStat(t, svc, probe, label, problems)

		// The admins' Kelola tag count and the delete's take-off — by tag alone.
		t.Logf("[%s] the admins' per-tag count:", label)
		san_perf.Explain(t, db, "SELECT tag_id, count(*) AS n FROM restock_tags WHERE tag_id IN ("+
			strconv.FormatUint(lebaran, 10)+", "+strconv.FormatUint(retur, 10)+") GROUP BY tag_id")
		t.Logf("[%s] the delete's take-off (a rare tag):", label)
		san_perf.Explain(t, db, "SELECT restock_id FROM restock_tags WHERE tag_id = "+strconv.FormatUint(retur, 10))
	}

	run("with restock_tags_tag_idx")

	err := db.Exec("DROP INDEX restock_tags_tag_idx").Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec("ANALYZE restock_tags").Error
	if err != nil {
		t.Fatal(err)
	}

	run("WITHOUT restock_tags_tag_idx")
}

// perfStat times the selling statistics under the problem list — the same predicate as the list.
func perfStat(t *testing.T, svc *inventory_v1.Service, probe *san_perf.Probe, label string, problems []uint64) {
	t.Helper()

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, _ := probe.Measure(func() {
			_, err := svc.RestockSellingStat(context.Background(), connect.NewRequest(&inventoryv1.RestockSellingStatRequest{
				TeamId: 2, Filter: &inventoryv1.RestockRequestListFilter{TagIds: problems},
			}))
			if err != nil {
				t.Fatalf("stat: %v", err)
			}
		})

		walls = append(walls, wall)
	}

	t.Logf("[%s] selling stat, the problem list: MEDIAN wall %v, %d queries", label, san_perf.Median(walls), probe.Count())
}
