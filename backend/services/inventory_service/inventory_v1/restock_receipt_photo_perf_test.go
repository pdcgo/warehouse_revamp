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
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockReceiptPhoto over 50 000 restocks (five selling teams, three warehouses), every one with a photo: the
// warehouse's own restock, and another warehouse's — one primary-key lookup each, then the link.
func TestPerf_RestockReceiptPhoto(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	rows := make([]inventory_service_models.Restock, 0, 50_000)

	for i := range 50_000 {
		rows = append(rows, inventory_service_models.Restock{
			TeamID:      uint64(2 + i%5),
			WarehouseID: uint64(900 + i%3),
			Status:      "ongoing",
			ReceiptFile: "doc-" + strconv.Itoa(i),
			CreatedAt:   now.Add(-time.Duration(i) * time.Minute),
			UpdatedAt:   now,
		})
	}

	san_perf.SeedRows(t, db, &rows)

	linker := &fakePhotoLinker{owners: map[string]uint64{}}
	for i := range rows {
		linker.owners[rows[i].ReceiptFile] = rows[i].TeamID
	}

	svc := photoService(db, linker)
	ctx := t.Context()

	restock := rows[25_000]
	other := 900 + (restock.WarehouseID-900+1)%3

	calls := map[string]func() error{
		"RestockReceiptPhoto own": func() error {
			_, err := svc.RestockReceiptPhoto(ctx, connect.NewRequest(&inventoryv1.RestockReceiptPhotoRequest{
				TeamId: restock.WarehouseID, RequestId: restock.ID,
			}))

			return err
		},
		"RestockReceiptPhoto another warehouse": func() error {
			_, err := svc.RestockReceiptPhoto(ctx, connect.NewRequest(&inventoryv1.RestockReceiptPhotoRequest{
				TeamId: other, RequestId: restock.ID,
			}))
			if connect.CodeOf(err) == connect.CodeNotFound {
				return nil
			}

			return err
		},
	}

	for name, call := range calls {
		err := call()
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = call() })
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
