//go:build perfaudit

// Performance audit for WarehouseTransferCreate and WarehouseTransferUpdate once they ask the account that pays the
// shipping (a-transfer-names-its-paying-account, a-transfers-shipping-is-paid-from-any-active-account), measured through the REAL
// wiring: the composition root's restockPayingAccounts → financial_account_v1.FinancialAccountByIds, on one probed
// database. The accounts are restock_accounts_perf_test.go's (the team holds 200, 40 marked operational, among 20 000 of
// other teams'); A holds 20 products over 10 batches each on 3 racks. The transfer has 1 line and 20.
//
//	go test -tags perfaudit -p 1 -run TestPerf_TransferPayingAccount -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const (
	perfTransferFrom    uint64 = 9_340_002
	perfTransferTo      uint64 = 9_340_003
	perfTransferProduct uint64 = 9_340_100 // the first of 20
)

// perfTransferShelf seeds A with 20 products, each 10 batches of 100 on 3 racks.
func perfTransferShelf(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	var restockTx uint64

	err := quiet.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (?, ?, 'restock') RETURNING id`,
		perfTransferFrom, perfRestockTeam).Scan(&restockTx).Error
	if err != nil {
		t.Fatalf("restock tx: %v", err)
	}

	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                       init_stock_count, init_stock_valuation)
		  SELECT ?, ?, ? + p, ?, 10000 + g, 100, (10000 + g) * 100, 100, (10000 + g) * 100
		  FROM generate_series(0, 19) p, generate_series(1, 10) g`,
			[]any{perfTransferFrom, perfRestockTeam, perfTransferProduct, restockTx}},
		{`INSERT INTO placements (warehouse_id, code, name) SELECT ?, 'perf-transfer-' || g, 'Rak' FROM generate_series(1, 3) g`,
			[]any{perfTransferFrom}},
		{`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		  SELECT ?, ?, ? + p, pl.id, CASE WHEN pl.code = 'perf-transfer-1' THEN 334 ELSE 333 END
		  FROM generate_series(0, 19) p, placements pl WHERE pl.warehouse_id = ? AND pl.code LIKE 'perf-transfer-%'`,
			[]any{perfRestockTeam, perfTransferFrom, perfTransferProduct, perfTransferFrom}},
		{`ANALYZE batches; ANALYZE product_placements`, nil},
	}

	for _, s := range statements {
		err = quiet.Exec(s.sql, s.args...).Error
		if err != nil {
			t.Fatalf("seed: %v\n%s", err, s.sql)
		}
	}
}

func TestPerf_TransferPayingAccount(t *testing.T) {
	raw := san_testdb.DB(t)
	account := perfRestockAccounts(t, raw)
	perfTransferShelf(t, raw)

	db, probe := san_perf.Wrap(raw)
	seam := NewRestockPayingAccounts(financial_account_v1.NewService(db, nil))
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, seam)
	ctx := context.Background()

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.WarehouseTransferLine, 0, size)
		for i := range size {
			lines = append(lines, &inventoryv1.WarehouseTransferLine{ProductId: perfTransferProduct + uint64(i), Count: 1})
		}

		var last uint64

		create := func() error {
			res, err := svc.WarehouseTransferCreate(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
				TeamId: perfRestockTeam, FromWarehouseId: perfTransferFrom, ToWarehouseId: perfTransferTo, Lines: lines,
				ShipmentCost: 18_000, FinanceAccountId: account, Note: "perf",
			}))
			if err == nil {
				last = res.Msg.GetTransfer().GetId()
			}

			return err
		}

		cost := 18_000.0

		// Every edit moves the cost, so the account is unchanged: the question is asked before the transaction and
		// not judged (the change rule) — the cost of asking is the same either way.
		update := func() error {
			cost += 1_000

			_, err := svc.WarehouseTransferUpdate(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferUpdateRequest{
				TeamId: perfRestockTeam, TransferId: last, ShipmentCost: cost, FinanceAccountId: account, Note: "perf",
			}))

			return err
		}

		// Warm-up: schema reflection and the pool are not the RPC's cost.
		err := create()
		if err != nil {
			t.Fatalf("warm-up: %v", err)
		}

		for _, c := range []struct {
			name string
			call func() error
		}{{"WarehouseTransferCreate", create}, {"WarehouseTransferUpdate", update}} {
			name := fmt.Sprintf("%s · %d line(s)", c.name, size)
			walls := make([]time.Duration, 0, 5)

			for range 5 {
				probe.Reset()

				wall, dbTime := probe.Measure(func() { err = c.call() })
				if err != nil {
					t.Fatalf("%s: %v", name, err)
				}

				walls = append(walls, wall)
				t.Logf("%s: wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
			}

			t.Logf("%s: median wall %v", name, san_perf.Median(walls))
			probe.Report(t, name)
		}
	}
}
