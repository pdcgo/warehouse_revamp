//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// 20 000 transfers — five selling teams between three warehouses — each with a trail of five rows (created, process,
// shipped, arrived, accepted): 100 000 `warehouse_transfer_logs`. One in fifty was opened by Root from outside. The
// list's created-by badge (`created_by_is_override`) is ONE extra query per page — the trail's first row per transfer
// of the page, by `warehouse_transfer_logs_transfer_idx` (transfer_id, id).
func TestPerf_WarehouseTransferList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	transfers := make([]models.WarehouseTransfer, 0, 20_000)

	for i := range 20_000 {
		team := uint64(2 + i%5)
		from := uint64(900 + i%3)
		transfers = append(transfers, models.WarehouseTransfer{
			TeamID:          team,
			FromWarehouseID: from,
			ToWarehouseID:   900 + (from-900+1)%3,
			Status:          models.TransferAccepted,
			CreatedByUserID: 1000*team + uint64(i%40),
			CreatedAt:       now.Add(-time.Duration(20_000-i) * time.Minute),
			UpdatedAt:       now,
		})
	}

	san_perf.SeedRows(t, db, &transfers)

	steps := []models.TransferStatus{
		models.TransferCreated, models.TransferProcess, models.TransferShipped, models.TransferArrived, models.TransferAccepted,
	}
	logs := make([]models.WarehouseTransferLog, 0, len(steps)*len(transfers))

	for i, tr := range transfers {
		var from models.TransferStatus

		for k, to := range steps {
			logs = append(logs, models.WarehouseTransferLog{
				TransferID:  tr.ID,
				FromStatus:  from,
				ToStatus:    to,
				ActorUserID: tr.CreatedByUserID,
				IsOverride:  k == 0 && i%50 == 0,
				CreatedAt:   tr.CreatedAt.Add(time.Duration(k) * time.Hour),
			})
			from = to
		}
	}

	san_perf.SeedRows(t, db, &logs)

	svc := newService(t, db)
	ctx := ctxUser(7)

	cases := []struct {
		name string
		req  *inventoryv1.WarehouseTransferListRequest
	}{
		{"selling, 20", &inventoryv1.WarehouseTransferListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"selling, 200", &inventoryv1.WarehouseTransferListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}}},
		{"selling, page 100 of 20", &inventoryv1.WarehouseTransferListRequest{TeamId: 2, Page: &commonv1.CommonPagination{Page: 100, Limit: 20}}},
		{"warehouse, 20", &inventoryv1.WarehouseTransferListRequest{TeamId: 900, Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
	}

	for _, c := range cases {
		res, err := svc.WarehouseTransferList(ctx, connect.NewRequest(c.req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		overrides := 0

		for _, item := range res.Msg.GetItems() {
			for _, tr := range item.GetWarehouseTransfer().GetMapData() {
				if tr.GetCreatedByIsOverride() {
					overrides++
				}
			}
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.WarehouseTransferList(ctx, connect.NewRequest(c.req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v, %d of %d rows badged", c.name, san_perf.Median(walls), overrides, len(res.Msg.GetIds()))

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			if strings.Contains(q.SQL, "warehouse_transfer_logs") {
				t.Logf("%s — the created-by lookup, %v:", c.name, q.Duration)
			}

			san_perf.Explain(t, db, q.SQL)
		}
	}
}
