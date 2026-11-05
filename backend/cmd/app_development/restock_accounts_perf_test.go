//go:build perfaudit

// Performance audit for RestockRequestCreate and RestockRequestUpdate once they ask the paying account
// (a-restock-names-its-paying-account), measured through the REAL wiring: the composition root's
// restockPayingAccounts → financial_account_v1.FinancialAccountByIds, on one probed database. The team holds 200
// accounts (40 marked operational) among 20 000 of other teams'; the restock has 1 line and 20.
//
//	go test -tags perfaudit -p 1 -run TestPerf_RestockPayingAccount -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"strings"
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
	perfRestockTeam      uint64 = 9_320_001
	perfRestockWarehouse uint64 = 9_320_002
)

// perfRestockAccounts seeds the accounts table and returns one of the team's operational accounts.
func perfRestockAccounts(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO financial_accounts (team_id, type, provider, status, name, created_at, updated_at)
		 SELECT 9330000 + g % 1000, 'cash', 'cash', 'active', 'Kas ' || g, now(), now() FROM generate_series(1, 20000) g`,
		`INSERT INTO financial_accounts (team_id, type, provider, status, name, created_at, updated_at)
		 SELECT 9320001, 'cash', 'cash', 'active', 'Kas Tim ' || g, now(), now() FROM generate_series(1, 200) g`,
		`INSERT INTO operational_accounts (team_id, account_id)
		 SELECT team_id, id FROM financial_accounts WHERE team_id = 9320001 AND id % 5 = 0`,
		`ANALYZE financial_accounts`,
		`ANALYZE operational_accounts`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("seed: %v\n%s", err, statement)
		}
	}

	var id uint64

	err := quiet.Raw(`SELECT account_id FROM operational_accounts WHERE team_id = ? ORDER BY account_id LIMIT 1`,
		perfRestockTeam).Scan(&id).Error
	if err != nil || id == 0 {
		t.Fatalf("an operational account: %v", err)
	}

	return id
}

func TestPerf_RestockPayingAccount(t *testing.T) {
	raw := san_testdb.DB(t)
	account := perfRestockAccounts(t, raw)

	db, probe := san_perf.Wrap(raw)
	seam := NewRestockPayingAccounts(financial_account_v1.NewService(db, nil))
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, seam)
	ctx := context.Background()

	for _, size := range []int{1, 20} {
		items := func(count int64) []*inventoryv1.RestockRequestItem {
			out := make([]*inventoryv1.RestockRequestItem, 0, size)
			for i := range size {
				out = append(out, &inventoryv1.RestockRequestItem{
					ProductId: uint64(9_321_000 + i), ProductCode: "PERF", Name: "Perf", Count: count, Total: 100_000,
				})
			}

			return out
		}

		var last uint64

		create := func() error {
			res, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
				TeamId: perfRestockTeam, WarehouseId: perfRestockWarehouse, FinanceAccountId: account, Items: items(10),
			}))
			if err == nil {
				last = res.Msg.GetRequest().GetId()
			}

			return err
		}

		update := func() error {
			_, err := svc.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
				TeamId: perfRestockTeam, RequestId: last, WarehouseId: perfRestockWarehouse, FinanceAccountId: account,
				Items: items(11),
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
		}{{"RestockRequestCreate", create}, {"RestockRequestUpdate", update}} {
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

	// The plan of the account question itself — the one statement this pass adds.
	probe.Reset()

	_, _, err := seam.Account(ctx, perfRestockTeam, account)
	if err != nil {
		t.Fatalf("account: %v", err)
	}

	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		t.Logf("account query: %s", q.SQL)
		san_perf.Explain(t, raw, q.SQL)
	}
}
