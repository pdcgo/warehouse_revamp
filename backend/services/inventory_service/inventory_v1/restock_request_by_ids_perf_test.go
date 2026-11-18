//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// CETAK LABEL'S ONE READ AT VOLUME (the-labels-mark-their-one-by-one-read). The ledger background (50 000 batches and
// their rack rows in 20 warehouses) and 50 000 more restocks with two lines each, then a full print: 50 restocks raised
// and accepted through the real writes into one warehouse, each line split over two racks with breakage. RestockRequestByIds
// is timed for the 50 with both slices, and for 5; the page's previous reads — RestockRequestDetail and
// RestockRequestLabels per restock, 100 calls for 50 — are timed beside it on the same seed as the control.
func TestPerf_RestockRequestByIds(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	statements := []string{
		`INSERT INTO restocks (team_id, warehouse_id, status, shipment_cost, subtotal, total, receipt, created_at, updated_at)
		 SELECT 2 + g % 40, 1 + g % 20, 'ongoing', 25000, 1000000, 1025000, 'BG' || g, NOW(), NOW()
		 FROM generate_series(1, 50000) g`,
		`INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total)
		 SELECT r.id, 100000 + (r.id + k) % 2500, 'SKU-' || k, 'background', 10, 500000
		 FROM restocks r CROSS JOIN generate_series(0, 1) k WHERE r.receipt LIKE 'BG%'`,
		// their trails (two rows each) and a broken unit on one in five — the tables the by-line and excluded reads touch
		`INSERT INTO restock_logs (restock_id, from_status, to_status, actor_user_id, description, created_at)
		 SELECT r.id, s.f, s.t, 7, 'background', NOW()
		 FROM restocks r CROSS JOIN (VALUES ('', 'ongoing'), ('ongoing', 'arrived')) AS s(f, t) WHERE r.receipt LIKE 'BG%'`,
		`INSERT INTO restock_problem_items (restock_id, product_id, problem_type, count)
		 SELECT r.id, 100000 + r.id % 2500, 'broken', 1 FROM restocks r WHERE r.receipt LIKE 'BG%' AND r.id % 5 = 0`,
	}

	for i, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	for _, table := range []string{"restocks", "restock_items", "restock_logs", "restock_problem_items"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	svc := newService(t, db)
	ctx := ctxUser(7)

	const seller, warehouse uint64 = 2, 931

	rackA := insertRack(t, quiet, warehouse, "P-01-1")
	rackB := insertRack(t, quiet, warehouse, "P-01-2")

	ids := make([]uint64, 0, 50)

	for i := range 50 {
		created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: seller, WarehouseId: warehouse, ShipmentCost: 80_000,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: uint64(700_000 + i), ProductCode: "KPH-001", Name: "Kaos Polos Hitam", Count: 100, Total: 4_000_000},
				{ProductId: uint64(800_000 + i), ProductCode: "TTM-207", Name: "Topi Trucker Merah", Count: 30, Total: 840_000},
			},
		}))
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}

		r := created.Msg.GetRequest()

		_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: r.GetId(), WarehouseAdditionalCost: 5_000, WarehouseAdditionalCostNote: courierNote,
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{
					ItemId: r.GetItems()[0].GetId(), ReceivedCount: 100,
					Placements: []*inventoryv1.RestockPlacement{{PlacementId: rackA, Quantity: 60}, {PlacementId: rackB, Quantity: 40}},
				},
				{
					ItemId: r.GetItems()[1].GetId(), ReceivedCount: 30, BrokenCount: 2, BrokenNote: "crushed",
					Placements: []*inventoryv1.RestockPlacement{{PlacementId: rackA, Quantity: 28}},
				},
			},
		}))
		if err != nil {
			t.Fatalf("accept %d: %v", i, err)
		}

		ids = append(ids, r.GetId())
	}

	for _, table := range []string{"restocks", "restock_items", "batches", "product_placement_logs", "restock_logs", "restock_problem_items"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	for _, n := range []int{50, 5} {
		req := &inventoryv1.RestockRequestByIdsRequest{
			TeamId: warehouse,
			Filter: &inventoryv1.RestockRequestByIdsFilter{Ids: ids[:n]},
			DataRequest: []inventoryv1.RestockRequestByIdsDataType{
				inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_RESTOCK_REQUEST,
				inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_LABELS,
			},
		}

		res, err := svc.RestockRequestByIds(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%d warm-up: %v", n, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.RestockRequestByIds(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("%d: %v", n, err)
			}

			walls = append(walls, wall)
			t.Logf("ByIds %d restocks wall=%v db=%v queries=%d", n, wall, dbTime, probe.Count())
		}

		labels := 0
		for _, list := range res.Msg.GetItems() {
			for _, item := range list.GetItems() {
				labels += len(item.GetLabels().GetLabels())
			}
		}

		t.Logf("ByIds %d restocks MEDIAN wall %v — %d answered, %d labels", n, san_perf.Median(walls), len(res.Msg.GetItems()), labels)

		if n != 50 {
			continue
		}

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, db, q.SQL)
		}
	}

	// THE CONTROL: what the page asked before — Detail and Labels for every restock, one call each.
	walls := make([]time.Duration, 0, 3)

	for range 3 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			for _, id := range ids {
				_, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{TeamId: warehouse, RequestId: id}))
				if err != nil {
					t.Fatalf("detail %d: %v", id, err)
				}

				_, err = svc.RestockRequestLabels(ctx, connect.NewRequest(&inventoryv1.RestockRequestLabelsRequest{TeamId: warehouse, RequestId: id}))
				if err != nil {
					t.Fatalf("labels %d: %v", id, err)
				}
			}
		})

		walls = append(walls, wall)
		t.Logf("one by one, 50 restocks (100 calls) wall=%v db=%v queries=%d", wall, dbTime, probe.Count())
	}

	t.Logf("one by one, 50 restocks (100 calls) MEDIAN wall %v", san_perf.Median(walls))
}
