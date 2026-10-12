//go:build perfaudit

package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// 50 000 restocks — a transaction-grain table: five selling teams of 10 000, three warehouses, 40 authors per
// team and 20 warehouse hands; half accepted. The who-list aggregates one team's rows, so its cost is that team's
// share of the table.
func TestPerf_RestockActorList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	rows := make([]inventory_service_models.RestockRequest, 0, 50_000)

	for i := range 50_000 {
		team := uint64(2 + i%5)
		row := inventory_service_models.RestockRequest{
			RequestingTeamID: team,
			WarehouseID:      uint64(900 + i%3),
			Status:           "pending",
			CreatedByUserID:  1000*team + uint64(i%40),
			CreatedAt:        now.Add(-time.Duration(i) * time.Minute),
			UpdatedAt:        now,
		}

		if i%2 == 0 {
			at := row.CreatedAt.Add(time.Hour)
			row.Status = "fulfilled"
			row.AcceptedByUserID = uint64(5000 + i%20)
			row.AcceptedAt = &at
		}

		rows = append(rows, row)
	}

	san_perf.SeedRows(t, db, &rows)

	svc := newService(t, db)
	ctx := ctxUser(7)

	for name, req := range map[string]*inventoryv1.RestockActorListRequest{
		"selling, created":    {TeamId: 2, Filter: &inventoryv1.RestockActorListFilter{Role: inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED}, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}},
		"selling, accepted":   {TeamId: 2, Filter: &inventoryv1.RestockActorListFilter{Role: inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_ACCEPTED}, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}},
		"warehouse, created":  {TeamId: 900, Filter: &inventoryv1.RestockActorListFilter{Role: inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED}, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}},
		"warehouse, accepted": {TeamId: 900, Filter: &inventoryv1.RestockActorListFilter{Role: inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_ACCEPTED}, Page: &commonv1.CommonPagination{Page: 1, Limit: 200}},
	} {
		_, err := svc.RestockActorList(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.RestockActorList(ctx, connect.NewRequest(req))
			})
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
