//go:build perfaudit

// Performance audit for ChargeTransferCourier (the audit-rpc-performance skill) — liability's listener on Warehouse
// Transfer Accepted. Its write is PostEntry's: a sequence value, two balance upserts and two log inserts guarded by the
// ledger's unique key. Measured on a full ledger: 50 000 log rows and 10 000 pairs of balances.
//
//	go test -tags perfaudit -run TestPerf_ChargeTransferCourier -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func TestPerf_ChargeTransferCourier(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	const warehouses, sellers = 200, 50

	balances := make([]liability_service_models.LiabilityBalance, 0, warehouses*sellers*2)
	logs := make([]liability_service_models.LiabilityLog, 0, 50_000)

	for w := uint64(0); w < warehouses; w++ {
		for s := uint64(0); s < sellers; s++ {
			warehouse, seller := 5000+w, 100+s
			balances = append(balances,
				liability_service_models.LiabilityBalance{TeamID: seller, CounterpartyID: warehouse, Balance: -1000},
				liability_service_models.LiabilityBalance{TeamID: warehouse, CounterpartyID: seller, Balance: 1000},
			)

			for i := uint64(0); i < 5 && len(logs) < cap(logs); i++ {
				source := w*1000 + s*10 + i + 1
				logs = append(logs,
					liability_service_models.LiabilityLog{TeamID: warehouse, CounterpartyID: seller, Amount: 200, SourceType: "transfer_fee", SourceID: source, GroupID: source},
					liability_service_models.LiabilityLog{TeamID: seller, CounterpartyID: warehouse, Amount: -200, SourceType: "transfer_fee", SourceID: source, GroupID: source},
				)
			}
		}
	}

	san_perf.SeedRows(t, db, balances)
	san_perf.SeedRows(t, db, logs)

	charge := func(i int) error {
		return svc.ChargeTransferCourier(ctx, liability_v1.TransferCourierCharge{
			TransferID: uint64(900_000 + i + 1), SellingTeamID: 120, WarehouseID: 5_010, Amount: 5_000, ActorID: 9,
		})
	}

	err := charge(-1)
	if err != nil {
		t.Fatalf("warm-up: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for i := range 5 {
		probe.Reset()

		var runErr error

		wall, dbTime := probe.Measure(func() { runErr = charge(i) })
		if runErr != nil {
			t.Fatalf("run %d: %v", i, runErr)
		}

		walls = append(walls, wall)
		t.Logf("run %d: wall=%v db=%v queries=%d", i, wall, dbTime, probe.Count())
	}

	t.Logf("PERF ChargeTransferCourier median=%v queries=%d", san_perf.Median(walls), probe.Count())
	probe.Report(t, "ChargeTransferCourier")
}
