//go:build perfaudit

// Performance audit for OrderCreate's idempotency-key lookup (backlog #10, slice 1, the-order-refuses-a-used-key) —
// the read OrderCreate now makes FIRST, on every create, over a 50 000-order table: the used-key refusal (the lookup
// alone) and a whole create under a fresh key (the lookup plus the placement it already made).
//
//	go test -tags perfaudit -run TestPerf_OrderCreateKeyLookup -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

const (
	perfKeyTeam      uint64 = 21_000 // clear of the unit tests' teams and of the other probes'
	perfKeyOrderRows        = 50_000
)

func TestPerf_OrderCreateKeyLookup(t *testing.T) {
	tx := san_testdb.DB(t)
	db, probe := san_perf.Wrap(tx)

	shop := insertShop(t, db, perfKeyTeam, "Toko Kunci", "KEY-PERF", "shopee")

	rows := make([]selling_service_models.Order, 0, perfKeyOrderRows)
	for i := range perfKeyOrderRows {
		rows = append(rows, selling_service_models.Order{
			IdempotencyKey: newOrderKey(),
			TeamID:         perfKeyTeam,
			ShopID:         shop,
			WarehouseID:    testWarehouse,
			Status:         "pending",
			CustomerName:   "Budi",
			GoodsCost:      float64(10_000 + i),
			PlatformTotal:  float64(15_000 + i),
			CreatedAt:      time.Now().Add(-time.Duration(i%90) * 24 * time.Hour),
			UpdatedAt:      time.Now(),
		})
	}

	san_perf.SeedRows(t, db, rows)

	err := db.Exec("ANALYZE orders").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	svc := newService(t, db)
	ctx := context.Background()
	used := rows[perfKeyOrderRows/2].IdempotencyKey

	for _, tc := range []struct {
		name string
		key  func() string
		ok   bool
	}{
		{"a used key — refused at the lookup", func() string { return used }, false},
		{"a fresh key — the whole create", newOrderKey, true},
	} {
		place := func() error {
			req := orderReq(shop)
			req.TeamId = perfKeyTeam
			req.IdempotencyKey = tc.key()

			_, err := svc.OrderCreate(ctx, connect.NewRequest(req))

			return err
		}

		// Warm-up: schema reflection and pool setup are not this RPC's cost.
		err = place()
		if (err == nil) != tc.ok {
			t.Fatalf("%s warm-up: %v", tc.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			var callErr error

			wall, dbTime := probe.Measure(func() {
				callErr = place()
			})
			if (callErr == nil) != tc.ok {
				t.Fatalf("%s: %v", tc.name, callErr)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", tc.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", tc.name, san_perf.Median(walls))
		probe.Report(t, "OrderCreate — "+tc.name)
	}

	// The lookup itself, on 50 000 rows: one row at most, read off orders_idempotency_key_idx.
	plan := san_perf.Explain(t, db, fmt.Sprintf(`SELECT count(*) FROM "orders" WHERE idempotency_key = '%s'`, used))
	if !strings.Contains(plan, "orders_idempotency_key_idx") {
		t.Fatalf("the key lookup does not use orders_idempotency_key_idx:\n%s", plan)
	}
}
