//go:build perfaudit

// Performance audit for ShopSettlementEntryList (the audit-rpc-performance skill).
//
//	go test -tags perfaudit -run TestPerf_ShopSettlementEntryList -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// seedLedger writes `rows` log rows for a team over 300 days, one in 40 a SHOP row (one in 80 a withdrawal) — the
// shape of a busy ledger, where an order writes several rows and the shop rows are a minority — and reverses one shop
// row in 50.
func seedLedger(t *testing.T, db *gorm.DB, teamID uint64, rows int) {
	t.Helper()

	err := db.Exec(`
INSERT INTO settlement_logs (order_id, shop_id, team_id, actor_id, source_type, settlement_type, change, balance,
                             unique_id, occurred_on, posted_on)
SELECT CASE WHEN g % 40 = 0 THEN NULL ELSE g END, 30 + g % 5, ?, 62, 'importer',
       CASE WHEN g % 80 = 0 THEN 'withdrawal' ELSE 'fund' END, 1000, 0,
       'perf-' || ?::bigint || '-' || g, DATE '2026-01-01' + (g % 300), DATE '2026-01-01' + (g % 300)
FROM generate_series(1, ?) AS g`, teamID, teamID, rows).Error
	if err != nil {
		t.Fatalf("seed the ledger: %v", err)
	}

	err = db.Exec(`
INSERT INTO settlement_logs (shop_id, team_id, actor_id, source_type, settlement_type, change, balance, unique_id,
                             occurred_on, posted_on, reverses_id)
SELECT shop_id, team_id, 61, 'manual', settlement_type, -change, 0, 'reverse-' || id, occurred_on, posted_on, id
FROM settlement_logs
WHERE team_id = ? AND order_id IS NULL AND id % 50 = 0`, teamID).Error
	if err != nil {
		t.Fatalf("seed the reversals: %v", err)
	}
}

func TestPerf_ShopSettlementEntryList(t *testing.T) {
	base := san_testdb.DB(t)

	// 200 000 rows a team (5 000 shop rows each), two teams.
	seedLedger(t, base, team, 200_000)
	seedLedger(t, base, team+1, 200_000)

	err := base.Exec(`ANALYZE settlement_logs`).Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	db, probe := san_perf.Wrap(base)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, &fakeStatements{lines: map[uint64]settlement_v1.StatementLine{}}, fakeNames{62: "Budi", 61: "Dewi"})
	ctx := context.Background()

	cases := []struct {
		name   string
		teamID uint64
		filter *settlementv1.ShopSettlementEntryListFilter
		page   uint32
	}{
		{"team, last month", team, &settlementv1.ShopSettlementEntryListFilter{PostedFrom: "2026-09-28", PostedTo: "2026-10-27"}, 1},
		{"team, all time, page 50", team, &settlementv1.ShopSettlementEntryListFilter{}, 50},
		{"team, one shop + withdrawals", team, &settlementv1.ShopSettlementEntryListFilter{
			ShopId:          30,
			SettlementTypes: []settlementv1.SettlementType{settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL},
		}, 1},
		{"root, last month", san_auth.RootTeamID, &settlementv1.ShopSettlementEntryListFilter{PostedFrom: "2026-09-28", PostedTo: "2026-10-27"}, 1},
	}

	run := func(label string) {
		for _, c := range cases {
			name := "ShopSettlementEntryList " + label + " " + c.name
			c := c

			measureRPC(t, probe, name, func() error {
				res, err := svc.ShopSettlementEntryList(ctx, connect.NewRequest(&settlementv1.ShopSettlementEntryListRequest{
					TeamId: c.teamID,
					Filter: c.filter,
					Page:   &commonv1.CommonPagination{Page: c.page, Limit: 20},
				}))
				if err == nil && len(res.Msg.GetIds()) == 0 {
					t.Fatalf("%s: an empty page", name)
				}

				return err
			})

			explain(t, base, probe)
		}
	}

	run("[with 00011]")

	// THE CONTROL: the same reads without the partial index, so the audit can say what it buys.
	err = base.Exec(`DROP INDEX settlement_logs_shop_rows_idx`).Error
	if err != nil {
		t.Fatalf("drop the index: %v", err)
	}

	run("[without the shop-rows index]")
}
