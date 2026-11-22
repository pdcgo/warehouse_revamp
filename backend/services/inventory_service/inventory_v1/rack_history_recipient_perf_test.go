//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A SHELF'S HISTORY WITH EACH SAMPLE'S RECIPIENT (backlog #108, a-sample-keeps-its-recipient): a sample row reads who
// received it from its own inventory transaction, by that transaction's primary key, and only a sample row asks. One rack
// with 5 000 rows on its ledger, each under its own transaction — every fifth a sample to its own recipient, the rest
// order takes — against the ledgers' background (50 000 transactions, 50 000 rack rows elsewhere). Page 1 and page 100
// (offset 4 950) of everything, and page 1 of the samples alone.
func TestPerf_RackHistory_ASamplesRecipient(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)
	// The background's accepted restocks carry no transaction (0); a real accepted restock carries its own — left at 0,
	// every row's `ref` (refExpr) seq-scans them.
	err := quiet.Exec(`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`).Error
	if err != nil {
		t.Fatalf("restock transactions: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil, nil, nil)
	rack := newRack(t, svc, otWarehouse, "perf-rh")
	product := perfProducts(1)[0]

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description, recipient)
		 SELECT ?, ?, CASE WHEN g % 5 = 0 THEN 'sample' ELSE 'order' END, 1, 'perf-rh-' || g,
		        CASE WHEN g % 5 = 0 THEN 'perf-recipient-' || g ELSE '' END
		 FROM generate_series(1, 5000) g`,
		`INSERT INTO product_placement_logs (warehouse_id, team_id, product_id, placement_id, transaction_id, change_type,
		                                     stock_change, stock_after, actor_id)
		 SELECT t.warehouse_id, t.team_id, ?, ?, t.id, t.tx_type, -1, 5000 - ROW_NUMBER() OVER (ORDER BY t.id), 1
		 FROM inventory_transactions t WHERE t.description LIKE 'perf-rh-%'
		 ORDER BY t.id`,
	}

	args := [][]any{
		{otWarehouse, otMelati},
		{product, rack},
	}

	for i, stmt := range statements {
		err = quiet.Exec(stmt, args[i]...).Error
		if err != nil {
			t.Fatalf("the rack's ledger, statement %d: %v", i, err)
		}
	}

	for _, table := range []string{"inventory_transactions", "product_placement_logs", "idempotency_order_check", "restocks"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	read := func(p uint32, kinds []inventoryv1.MovementKind, want uint64) func(int) error {
		return func(int) error {
			res, callErr := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
				TeamId:      otWarehouse,
				Filter:      &inventoryv1.RackHistoryFilter{RackId: rack, Kinds: kinds},
				DataRequest: []inventoryv1.RackHistoryDataType{inventoryv1.RackHistoryDataType_RACK_HISTORY_DATA_TYPE_MOVEMENT},
				Page:        &commonv1.CommonPagination{Page: p, Limit: 50},
			}))
			if callErr == nil && res.Msg.GetPageInfo().GetTotalItems() != want {
				t.Fatalf("total = %d, want %d", res.Msg.GetPageInfo().GetTotalItems(), want)
			}

			return callErr
		}
	}

	for _, p := range []uint32{1, 100} {
		perfRun(t, db, probe, "RackHistory (all)", int(p), read(p, nil, 5000))
	}

	perfRun(t, db, probe, "RackHistory (samples)", 1, read(1, []inventoryv1.MovementKind{
		inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE,
	}, 1000))
}
