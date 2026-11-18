//go:build perfaudit

package inventory_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// RestockDoorPhotos over 20 000 accepted restocks (five selling teams, three warehouses), each with two lines — one
// broken and photographed, one short — and a slip, plus one restock of twenty lines, every one broken and photographed:
// the read both detail pages make. One primary-key lookup, one index range on the problem rows' unique key, then a link
// per photo.
func TestPerf_RestockDoorPhotos(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	seed := []string{
		`INSERT INTO restocks (team_id, warehouse_id, status, receipt, warehouse_additional_cost,
		        warehouse_additional_cost_note, warehouse_additional_cost_file, created_at, updated_at)
		 SELECT 2 + g % 5, 900 + g % 3, 'accepted', 'PERF-DOOR-' || g, 5000, 'cod', 'slip-' || g, NOW(), NOW()
		 FROM generate_series(1, 20000) g`,
		`INSERT INTO restocks (team_id, warehouse_id, status, receipt, warehouse_additional_cost,
		        warehouse_additional_cost_note, warehouse_additional_cost_file, created_at, updated_at)
		 VALUES (2, 900, 'accepted', 'PERF-DOOR-WIDE', 5000, 'cod', 'slip-wide', NOW(), NOW())`,
		`INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total, price_unit, created_at, updated_at)
		 SELECT r.id, p, 'P' || p, 'Produk ' || p, 10, 100000, 10000, NOW(), NOW()
		 FROM restocks r CROSS JOIN generate_series(1, 2) p
		 WHERE r.receipt LIKE 'PERF-DOOR-%' AND r.receipt <> 'PERF-DOOR-WIDE'`,
		`INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total, price_unit, created_at, updated_at)
		 SELECT r.id, p, 'P' || p, 'Produk ' || p, 10, 100000, 10000, NOW(), NOW()
		 FROM restocks r CROSS JOIN generate_series(1, 20) p
		 WHERE r.receipt = 'PERF-DOOR-WIDE'`,
		`INSERT INTO restock_problem_items (restock_id, product_id, problem_type, count, price_unit, total, photo_file)
		 SELECT i.restock_id, i.product_id, 'broken', 1, 10000, 10000, 'broken-' || i.id
		 FROM restock_items i JOIN restocks r ON r.id = i.restock_id
		 WHERE r.receipt LIKE 'PERF-DOOR-%' AND (i.product_id = 1 OR r.receipt = 'PERF-DOOR-WIDE')`,
		`INSERT INTO restock_problem_items (restock_id, product_id, problem_type, count, price_unit, total)
		 SELECT i.restock_id, i.product_id, 'missing', 1, 10000, 10000
		 FROM restock_items i JOIN restocks r ON r.id = i.restock_id
		 WHERE r.receipt LIKE 'PERF-DOOR-%' AND r.receipt <> 'PERF-DOOR-WIDE' AND i.product_id = 2`,
		`ANALYZE restocks`,
		`ANALYZE restock_items`,
		`ANALYZE restock_problem_items`,
	}

	for _, sql := range seed {
		err := db.Exec(sql).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	var target struct {
		ID          uint64
		TeamID      uint64
		WarehouseID uint64
	}

	err := db.
		Raw(`SELECT id, team_id, warehouse_id FROM restocks WHERE receipt = 'PERF-DOOR-WIDE'`).
		Scan(&target).
		Error
	if err != nil {
		t.Fatal(err)
	}

	var middle struct {
		ID          uint64
		WarehouseID uint64
	}

	err = db.
		Raw(`SELECT id, warehouse_id FROM restocks WHERE receipt = 'PERF-DOOR-10000'`).
		Scan(&middle).
		Error
	if err != nil {
		t.Fatal(err)
	}

	// Every photo the seed names is its warehouse's own upload.
	var docs []struct {
		Doc         string
		WarehouseID uint64
	}

	err = db.
		Raw(`SELECT p.photo_file AS doc, r.warehouse_id FROM restock_problem_items p JOIN restocks r ON r.id = p.restock_id
		     WHERE p.photo_file <> '' AND r.id IN (?, ?)
		     UNION ALL
		     SELECT warehouse_additional_cost_file, warehouse_id FROM restocks WHERE id IN (?, ?)`,
			target.ID, middle.ID, target.ID, middle.ID).
		Scan(&docs).
		Error
	if err != nil {
		t.Fatal(err)
	}

	linker := &fakePhotoLinker{owners: map[string]uint64{}}
	for _, d := range docs {
		linker.owners[d.Doc] = d.WarehouseID
	}

	svc := photoService(db, linker)
	ctx := t.Context()

	read := func(team, restock uint64, wantBroken int) func() error {
		return func() error {
			res, readErr := svc.RestockDoorPhotos(ctx, connect.NewRequest(&inventoryv1.RestockDoorPhotosRequest{
				TeamId: team, RequestId: restock,
			}))
			if readErr != nil {
				return readErr
			}

			if len(res.Msg.GetBroken()) != wantBroken || res.Msg.GetCourierSlipUrl() == "" {
				t.Fatalf("restock %d: %d broken photos and slip %q, want %d and a slip",
					restock, len(res.Msg.GetBroken()), res.Msg.GetCourierSlipUrl(), wantBroken)
			}

			return nil
		}
	}

	calls := []struct {
		name string
		call func() error
	}{
		{"RestockDoorPhotos seller, 20 photographed lines", read(target.TeamID, target.ID, 20)},
		{"RestockDoorPhotos warehouse, 20 photographed lines", read(target.WarehouseID, target.ID, 20)},
		{"RestockDoorPhotos warehouse, 1 of 2 lines", read(middle.WarehouseID, middle.ID, 1)},
		{"RestockDoorPhotos another team", func() error {
			_, readErr := svc.RestockDoorPhotos(ctx, connect.NewRequest(&inventoryv1.RestockDoorPhotosRequest{
				TeamId: 999, RequestId: target.ID,
			}))
			if connect.CodeOf(readErr) == connect.CodeNotFound {
				return nil
			}

			return readErr
		}},
	}

	for _, c := range calls {
		err = c.call()
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = c.call() })
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", c.name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}

	t.Log("seeded restocks: " + strconv.Itoa(20001))
}
