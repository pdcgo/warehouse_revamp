//go:build perfaudit

// Performance audit for the batch screens naming a return's order (a-returns-batch-opens-its-order, the
// audit-rpc-performance skill): what the ONE extra read per page — selling's OrderIDsByReturnTransactions through the
// composition root's ReturnOrders — adds to BatchList and BatchDetail at volume, and what selling 00050's partial index
// on orders.return_transaction_id buys it.
//
//	go test -tags perfaudit -p 1 -run TestPerf_ReturnOrders -v ./backend/cmd/app_development/
package main

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

const (
	perfRoWarehouse uint64 = 9_000_650
	perfRoTeam      uint64 = 9_000_651
)

// perfRoTime is the median wall time of n calls.
func perfRoTime(t *testing.T, n int, fn func() error) time.Duration {
	t.Helper()

	runs := make([]time.Duration, 0, n)

	for range n {
		start := time.Now()

		err := fn()
		if err != nil {
			t.Fatalf("perf call: %v", err)
		}

		runs = append(runs, time.Since(start))
	}

	return san_perf.Median(runs)
}

// THE VOLUME. One warehouse holds 60 000 batches, one transaction each; one in ten is a return's (6 000) and the newest
// 200 are ALL returns' — the worst page, every row asking for its order. selling holds 200 000 orders of the team, 6 180
// of them returned, each naming one of those return transactions.
func perfRoVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		  SELECT ?, ?, CASE WHEN g % 10 = 0 OR g > 59800 THEN 'return' ELSE 'restock' END, 1, 'perf-ro'
		  FROM generate_series(1, 60000) g`, []any{perfRoWarehouse, perfRoTeam}},
		{`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, created_at)
		  SELECT t.warehouse_id, t.team_id, 500000 + t.id % 3000, t.id, 1000, 2, 2000, 2, 2000,
		         NOW() - (t.id % 1461) * INTERVAL '1 day'
		  FROM inventory_transactions t WHERE t.description = 'perf-ro'`, nil},
		{`INSERT INTO shops (team_id, name, shop_code, marketplace) VALUES (?, 'Toko Perf', 'PRF', 'shopee')`,
			[]any{perfRoTeam}},
		{`INSERT INTO orders (team_id, shop_id, status, warehouse_id, idempotency_key, return_transaction_id)
		  SELECT ?, (SELECT id FROM shops WHERE shop_code = 'PRF' AND team_id = ?),
		         CASE WHEN r.id IS NULL THEN 'delivered' ELSE 'return_completed' END, ?, 'perf-ro-' || g, r.id
		  FROM generate_series(1, 200000) g
		  LEFT JOIN (SELECT id, row_number() OVER (ORDER BY id) * 32 AS slot FROM inventory_transactions
		             WHERE description = 'perf-ro' AND tx_type = 'return') r ON r.slot = g`,
			[]any{perfRoTeam, perfRoTeam, perfRoWarehouse}},
	}

	for i, s := range statements {
		err := quiet.Exec(s.sql, s.args...).Error
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	for _, table := range []string{"inventory_transactions", "batches", "shops", "orders"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func TestPerf_ReturnOrders(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	ctx := context.Background()

	perfRoVolume(t, db)

	var named int64

	err := quiet.Raw(`SELECT COUNT(*) FROM orders WHERE return_transaction_id IS NOT NULL AND team_id = ?`, perfRoTeam).
		Scan(&named).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	t.Logf("seeded: 60 000 batches, 200 000 orders, %d naming a return", named)

	without := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	with := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, NewInventoryReturnOrders(db), nil)

	list := func(svc *inventory_v1.Service, page, limit uint32) func() error {
		return func() error {
			_, callErr := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{
				TeamId: perfRoWarehouse, Page: &commonv1.CommonPagination{Page: page, Limit: limit},
			}))

			return callErr
		}
	}

	var summary strings.Builder

	summary.WriteString("\n| case | without the order read | with it | statements | page's return transactions |\n|---|---|---|---|---|\n")

	for _, c := range []struct {
		name        string
		page, limit uint32
	}{
		{"BatchList page 1 of 50 (all returns)", 1, 50},
		{"BatchList page 1 of 200 (all returns)", 1, 200},
		{"BatchList page 2 of 200 (one in ten)", 2, 200},
		{"BatchList page 150 of 200 (one in ten)", 150, 200},
	} {
		base := perfRoTime(t, 15, list(without, c.page, c.limit))
		added := perfRoTime(t, 15, list(with, c.page, c.limit))

		probe.Reset()

		res, callErr := with.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{
			TeamId: perfRoWarehouse, Page: &commonv1.CommonPagination{Page: c.page, Limit: c.limit},
		}))
		if callErr != nil {
			t.Fatalf("%s: %v", c.name, callErr)
		}

		returns := 0

		for _, item := range res.Msg.GetItems() {
			for _, b := range item.GetBatch().GetMapData() {
				if b.GetOrigin() == inventoryv1.BatchOrigin_BATCH_ORIGIN_RETURN {
					if b.GetReturnOrderId() == 0 {
						t.Fatalf("%s: return batch %d names no order", c.name, b.GetId())
					}

					returns++
				}
			}
		}

		summary.WriteString("| " + c.name + " | " + base.Round(10*time.Microsecond).String() + " | " +
			added.Round(10*time.Microsecond).String() + " | " + strconv.Itoa(probe.Count()) + " | " + strconv.Itoa(returns) + " |\n")
	}

	// BatchDetail of a return's batch.
	var returnBatch uint64

	err = quiet.Raw(`SELECT b.id FROM batches b JOIN inventory_transactions t ON t.id = b.transaction_id
		WHERE b.warehouse_id = ? AND t.tx_type = 'return' ORDER BY b.id LIMIT 1 OFFSET 3000`, perfRoWarehouse).
		Scan(&returnBatch).
		Error
	if err != nil {
		t.Fatalf("a return batch: %v", err)
	}

	detail := func(svc *inventory_v1.Service) func() error {
		return func() error {
			_, callErr := svc.BatchDetail(ctx, connect.NewRequest(&inventoryv1.BatchDetailRequest{
				TeamId: perfRoWarehouse, BatchId: returnBatch,
			}))

			return callErr
		}
	}

	summary.WriteString("| BatchDetail of a return's batch | " +
		perfRoTime(t, 15, detail(without)).Round(10*time.Microsecond).String() + " | " +
		perfRoTime(t, 15, detail(with)).Round(10*time.Microsecond).String() + " | | 1 |\n")

	t.Log(summary.String())

	// THE ORDER READ ALONE, for the worst page's 200 transactions: with selling 00050's index, then without it (dropped
	// inside the test's transaction, rolled back with it).
	var worst []uint64

	err = quiet.Raw(`SELECT t.id FROM inventory_transactions t WHERE t.description = 'perf-ro' AND t.tx_type = 'return'
		ORDER BY t.id DESC LIMIT 200`).
		Scan(&worst).
		Error
	if err != nil {
		t.Fatalf("worst page: %v", err)
	}

	read := func() error {
		_, callErr := selling_v1.OrderIDsByReturnTransactions(ctx, quiet, worst)

		return callErr
	}

	probe.Reset()

	_, err = selling_v1.OrderIDsByReturnTransactions(ctx, db, worst)
	if err != nil {
		t.Fatalf("order read: %v", err)
	}

	statement := probe.Queries()[0].SQL

	indexed := perfRoTime(t, 25, read)
	san_perf.Explain(t, db, statement)

	err = quiet.Exec(`DROP INDEX orders_return_transaction_idx`).Error
	if err != nil {
		t.Fatalf("drop the index: %v", err)
	}

	err = quiet.Exec(`ANALYZE orders`).Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	unindexed := perfRoTime(t, 25, read)
	san_perf.Explain(t, db, statement)

	worstWithout := perfRoTime(t, 15, list(with, 1, 200))

	t.Logf("the order read for 200 return transactions over 200 000 orders: with the index %v, without it %v; "+
		"BatchList page 1 of 200 with the read, unindexed: %v",
		indexed.Round(10*time.Microsecond), unindexed.Round(10*time.Microsecond), worstWithout.Round(10*time.Microsecond))
}
