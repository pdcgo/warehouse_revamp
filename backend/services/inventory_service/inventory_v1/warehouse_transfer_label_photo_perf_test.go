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
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferLabelPhoto over 50 000 shipped transfers (five selling teams, three sending and three receiving
// warehouses), every one with a photo: the sender, the receiver, the owning seller, and a fourth team (NotFound) — one
// primary-key lookup each, then the link.
func TestPerf_WarehouseTransferLabelPhoto(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	rows := make([]models.WarehouseTransfer, 0, 50_000)

	for i := range 50_000 {
		rows = append(rows, models.WarehouseTransfer{
			TeamID:          uint64(2 + i%5),
			FromWarehouseID: uint64(900 + i%3),
			ToWarehouseID:   uint64(910 + i%3),
			Status:          models.TransferShipped,
			ReceiptFile:     "doc-" + strconv.Itoa(i),
			ShippedAt:       &now,
			CreatedAt:       now.Add(-time.Duration(i) * time.Minute),
			UpdatedAt:       now,
		})
	}

	san_perf.SeedRows(t, db, &rows)

	linker := &fakePhotoLinker{owners: map[string]uint64{}}
	for i := range rows {
		linker.owners[rows[i].ReceiptFile] = rows[i].FromWarehouseID
	}

	svc := photoService(db, linker)
	ctx := t.Context()

	transfer := rows[25_000]

	ask := func(team uint64, wantNotFound bool) func() error {
		return func() error {
			_, err := svc.WarehouseTransferLabelPhoto(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferLabelPhotoRequest{
				TeamId: team, TransferId: transfer.ID,
			}))
			if wantNotFound && connect.CodeOf(err) == connect.CodeNotFound {
				return nil
			}

			return err
		}
	}

	calls := []struct {
		name string
		call func() error
	}{
		{"sender A", ask(transfer.FromWarehouseID, false)},
		{"receiver B", ask(transfer.ToWarehouseID, false)},
		{"owning seller", ask(transfer.TeamID, false)},
		{"a fourth team (NotFound)", ask(999, true)},
	}

	for _, c := range calls {
		err := c.call()
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
}
