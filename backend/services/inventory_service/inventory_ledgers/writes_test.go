package inventory_ledgers_test

import (
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Two takes of one batch in one call: the batch is stored once, at its last state, and each log row carries the state
// after its own change (ledger-writes-are-set-based).
func TestBatchWrites_ARowChangedTwiceIsStoredOnceAndLoggedTwice(t *testing.T) {
	db := san_testdb.DB(t)

	batch := mint(t, db, melati, kaosHitam, 5, 10000)
	order := transaction(t, db, melati, models.TxOrder)

	locked, err := inventory_ledgers.LockBatches(db, gudangBarat, []inventory_ledgers.ProductOwner{
		{TeamID: melati, ProductID: kaosHitam},
	})
	if err != nil {
		t.Fatalf("LockBatches: %v", err)
	}

	var w inventory_ledgers.BatchWrites

	for range 2 {
		_, err = inventory_ledgers.TakeOldestFirst(locked, &w, inventory_ledgers.Take{
			Transaction: order, TeamID: melati, ProductID: kaosHitam, Count: 2, ChangeType: string(models.TxOrder),
		})
		if err != nil {
			t.Fatalf("TakeOldestFirst: %v", err)
		}
	}

	err = w.Flush(db)
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}

	if b := batchByID(t, db, batch.ID); b.StockCount != 1 || !san_money.Equal(b.StockValuation, 10000) {
		t.Fatalf("batch holds %d worth %v, want 1 worth 10000", b.StockCount, b.StockValuation)
	}

	var logs []models.BatchLog
	db.Where("transaction_id = ?", order.ID).Order("id").Find(&logs)

	if len(logs) != 2 || logs[0].StockCountAfter != 3 || logs[1].StockCountAfter != 1 ||
		!san_money.Equal(logs[1].StockValuationAfter, 10000) {
		t.Fatalf("logs = %+v, want two rows: after 3, then after 1 worth 10000", logs)
	}
}

// The statements a ledger write costs do not grow with its lines: one product or ten, a mint is 3 statements, a put 4,
// and a take of both ledgers 6 (ledger-writes-are-set-based). This is the audit's N+1, pinned.
func TestLedgerWrites_TheStatementsDoNotGrowWithTheLines(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	products := []uint64{kaosHitam, kaosPolos, 76, 77, 78, 79, 80, 81, 82, 83}
	rakA := rack(t, db, "rak-a")
	rakB := rack(t, db, "rak-b")

	statements := func(n int) (mint, put, take int) {
		restock := transaction(t, db, melati, models.TxRestock)

		mints := make([]inventory_ledgers.Mint, 0, n)
		puts := make([]inventory_ledgers.Put, 0, 2*n)
		owners := make([]inventory_ledgers.ProductOwner, 0, n)

		for _, p := range products[:n] {
			mints = append(mints, inventory_ledgers.Mint{
				Transaction: restock, TeamID: melati, ProductID: p, Count: 4, PriceUnit: 10000,
				ChangeType: string(models.TxRestock),
			})
			puts = append(puts,
				inventory_ledgers.Put{TeamID: melati, ProductID: p, PlacementID: rakA, Count: 3},
				inventory_ledgers.Put{TeamID: melati, ProductID: p, PlacementID: rakB, Count: 1},
			)
			owners = append(owners, inventory_ledgers.ProductOwner{TeamID: melati, ProductID: p})
		}

		probe.Reset()

		_, err := inventory_ledgers.MintBatches(db, mints)
		if err != nil {
			t.Fatalf("MintBatches: %v", err)
		}

		mint = probe.Count()
		probe.Reset()

		_, err = inventory_ledgers.PutOnPlacements(db, restock, string(models.TxRestock), ani, "", puts)
		if err != nil {
			t.Fatalf("PutOnPlacements: %v", err)
		}

		put = probe.Count()

		order := transaction(t, db, melati, models.TxOrder)
		probe.Reset()

		locked, err := inventory_ledgers.LockBatches(db, gudangBarat, owners)
		if err != nil {
			t.Fatalf("LockBatches: %v", err)
		}

		var batchWrites inventory_ledgers.BatchWrites
		for _, o := range owners {
			_, err = inventory_ledgers.TakeOldestFirst(locked, &batchWrites, inventory_ledgers.Take{
				Transaction: order, TeamID: o.TeamID, ProductID: o.ProductID, Count: 2, ChangeType: string(models.TxOrder),
			})
			if err != nil {
				t.Fatalf("TakeOldestFirst: %v", err)
			}
		}

		err = batchWrites.Flush(db)
		if err != nil {
			t.Fatalf("Flush batches: %v", err)
		}

		racks, err := inventory_ledgers.LockRacks(db, gudangBarat, owners)
		if err != nil {
			t.Fatalf("LockRacks: %v", err)
		}

		var rackWrites inventory_ledgers.RackWrites
		for _, o := range owners {
			// 2 off racks holding 3 and 1: the 1 goes first, then 1 of the 3 — two rows a product.
			_, err = inventory_ledgers.TakeFewestFirst(racks, &rackWrites, order, inventory_ledgers.PlacementTake{
				TeamID: o.TeamID, ProductID: o.ProductID, Count: 2, ChangeType: string(models.TxOrder),
			})
			if err != nil {
				t.Fatalf("TakeFewestFirst: %v", err)
			}
		}

		err = rackWrites.Flush(db)
		if err != nil {
			t.Fatalf("Flush racks: %v", err)
		}

		take = probe.Count()

		items := make([]inventory_ledgers.ItemLine, 0, n)
		for _, o := range owners {
			items = append(items, inventory_ledgers.ItemLine{ProductID: o.ProductID, ProductTeamID: melati, Quantity: 2, Total: 20000})
		}

		err = inventory_ledgers.AddItems(db, order, items)
		if err != nil {
			t.Fatalf("AddItems: %v", err)
		}

		err = inventory_ledgers.Verify(db, order.ID)
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}

		return mint, put, take
	}

	// One product first, then ten others — fresh rows each time, so the puts create every rack row both times.
	oneMint, onePut, oneTake := statements(1)

	products = products[1:]
	tenMint, tenPut, tenTake := statements(9)

	if oneMint != 3 || tenMint != 3 {
		t.Fatalf("a mint cost %d statements for 1 product and %d for 9, want 3 both", oneMint, tenMint)
	}

	if onePut != 4 || tenPut != 4 {
		t.Fatalf("a put cost %d statements for 1 product and %d for 9, want 4 both", onePut, tenPut)
	}

	if oneTake != 6 || tenTake != 6 {
		t.Fatalf("a take cost %d statements for 1 product and %d for 9, want 6 both", oneTake, tenTake)
	}
}
