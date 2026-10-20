package inventory_ledgers_test

import (
	"errors"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

const (
	gudangBarat uint64 = 900
	melati      uint64 = 12
	sinar       uint64 = 13
	kaosHitam   uint64 = 74
	kaosPolos   uint64 = 75
	ani         uint64 = 5
)

func rack(t *testing.T, db *gorm.DB, code string) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`INSERT INTO placements (warehouse_id, code, name) VALUES (?, ?, ?) RETURNING id`,
		gudangBarat, code, code).Scan(&id).Error
	if err != nil {
		t.Fatalf("rack %s: %v", code, err)
	}

	return id
}

func transaction(t *testing.T, db *gorm.DB, team uint64, txType models.TxType) models.InventoryTransaction {
	t.Helper()

	row, err := inventory_ledgers.CreateTransaction(db, inventory_ledgers.NewTransaction{
		WarehouseID: gudangBarat, TeamID: team, TxType: txType, ActorID: ani,
	})
	if err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}

	return row
}

func mint(t *testing.T, db *gorm.DB, team, product uint64, count int64, price float64) models.Batch {
	t.Helper()

	batch, err := inventory_ledgers.MintBatch(db, inventory_ledgers.Mint{
		Transaction: transaction(t, db, team, models.TxRestock),
		TeamID:      team, ProductID: product, Count: count, PriceUnit: price,
		ChangeType: string(models.TxRestock), ActorID: ani,
	})
	if err != nil {
		t.Fatalf("MintBatch: %v", err)
	}

	return batch
}

// takeOldest is a whole take of one product: lock its batches, take oldest first, store.
func takeOldest(db *gorm.DB, take inventory_ledgers.Take) ([]inventory_ledgers.BatchTaken, error) {
	locked, err := inventory_ledgers.LockBatches(db, take.Transaction.WarehouseID, []inventory_ledgers.ProductOwner{
		{TeamID: take.TeamID, ProductID: take.ProductID},
	})
	if err != nil {
		return nil, err
	}

	var w inventory_ledgers.BatchWrites

	taken, err := inventory_ledgers.TakeOldestFirst(locked, &w, take)
	if err != nil {
		return nil, err
	}

	return taken, w.Flush(db)
}

// takeFewest is a whole rack take of one product: lock its rack rows, take fewest first, store.
func takeFewest(
	db *gorm.DB,
	tx models.InventoryTransaction,
	take inventory_ledgers.PlacementTake,
) ([]inventory_ledgers.RackChange, error) {
	locked, err := inventory_ledgers.LockRacks(db, tx.WarehouseID, []inventory_ledgers.ProductOwner{
		{TeamID: take.TeamID, ProductID: take.ProductID},
	})
	if err != nil {
		return nil, err
	}

	var w inventory_ledgers.RackWrites

	changes, err := inventory_ledgers.TakeFewestFirst(locked, &w, tx, take)
	if err != nil {
		return nil, err
	}

	return changes, w.Flush(db)
}

func batchByID(t *testing.T, db *gorm.DB, id uint64) models.Batch {
	t.Helper()

	var b models.Batch

	err := db.First(&b, id).Error
	if err != nil {
		t.Fatalf("batch %d: %v", id, err)
	}

	return b
}

// A mint writes the batch, its first log row and its first price, and keeps the minted figures in init_*.
func TestMintBatch_WritesTheBatchItsLogAndItsFirstPrice(t *testing.T) {
	db := san_testdb.DB(t)

	batch := mint(t, db, melati, kaosHitam, 10, 11200)

	if batch.StockCount != 10 || !san_money.Equal(batch.StockValuation, 112000) {
		t.Fatalf("batch holds %d units worth %v, want 10 worth 112000", batch.StockCount, batch.StockValuation)
	}

	if batch.InitStockCount != 10 || !san_money.Equal(batch.InitStockValuation, 112000) {
		t.Fatalf("init holds %d worth %v, want the minted figures", batch.InitStockCount, batch.InitStockValuation)
	}

	var logs []models.BatchLog
	db.Where("batch_id = ?", batch.ID).Find(&logs)

	if len(logs) != 1 || logs[0].ChangeCount != 10 || logs[0].StockCountAfter != 10 || logs[0].PriceUnitAfter != 11200 {
		t.Fatalf("mint log = %+v, want one row +10, after 10, price 11200", logs)
	}

	var prices []models.BatchPriceLog
	db.Where("batch_id = ?", batch.ID).Find(&prices)

	if len(prices) != 1 || prices[0].NewPriceUnit != 11200 || prices[0].DeltaPriceUnit != 11200 {
		t.Fatalf("price log = %+v, want the first price 11200 with delta 11200", prices)
	}
}

// The oldest batch gives up its units first, and a take spills into the next batch.
func TestTakeOldestFirst_TakesTheOldestBatchFirstAndSpills(t *testing.T) {
	db := san_testdb.DB(t)

	older := mint(t, db, melati, kaosHitam, 2, 10000)
	newer := mint(t, db, melati, kaosHitam, 5, 12000)

	taken, err := takeOldest(db, inventory_ledgers.Take{
		Transaction: transaction(t, db, melati, models.TxOrder),
		TeamID:      melati, ProductID: kaosHitam, Count: 3, ChangeType: string(models.TxOrder), ActorID: ani,
	})
	if err != nil {
		t.Fatalf("TakeOldestFirst: %v", err)
	}

	if len(taken) != 2 || taken[0].BatchID != older.ID || taken[0].Count != 2 || taken[1].BatchID != newer.ID || taken[1].Count != 1 {
		t.Fatalf("taken = %+v, want 2 from the older batch then 1 from the newer", taken)
	}

	count, value := inventory_ledgers.TotalTaken(taken)
	if count != 3 || !san_money.Equal(value, 32000) {
		t.Fatalf("total taken %d worth %v, want 3 worth 32000", count, value)
	}

	if b := batchByID(t, db, newer.ID); b.StockCount != 4 || !san_money.Equal(b.StockValuation, 48000) {
		t.Fatalf("newer batch holds %d worth %v, want 4 worth 48000", b.StockCount, b.StockValuation)
	}
}

// 3 units bought for Rp 10.000, taken one at a time: the batch ends at exactly 0, not 0,0001
// (an-emptying-take-takes-all-the-value).
func TestTakeOldestFirst_TheEmptyingTakeTakesAllTheValue(t *testing.T) {
	db := san_testdb.DB(t)

	batch := mint(t, db, melati, kaosHitam, 3, 10000.0/3)

	var totalOut float64

	for range 3 {
		taken, err := takeOldest(db, inventory_ledgers.Take{
			Transaction: transaction(t, db, melati, models.TxOrder),
			TeamID:      melati, ProductID: kaosHitam, Count: 1, ChangeType: string(models.TxOrder), ActorID: ani,
		})
		if err != nil {
			t.Fatalf("TakeOldestFirst: %v", err)
		}

		_, value := inventory_ledgers.TotalTaken(taken)
		totalOut += value
	}

	b := batchByID(t, db, batch.ID)
	if b.StockCount != 0 || b.StockValuation != 0 {
		t.Fatalf("emptied batch holds %d worth %v, want exactly 0 and 0", b.StockCount, b.StockValuation)
	}

	if !san_money.Equal(totalOut, 10000) {
		t.Fatalf("the three takes removed %v, want all 10000", totalOut)
	}
}

// Too few units is refused, names both numbers, and writes nothing.
func TestTakeOldestFirst_RefusesMoreThanTheBatchesHoldAndWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)

	batch := mint(t, db, melati, kaosHitam, 2, 10000)
	order := transaction(t, db, melati, models.TxOrder)

	_, err := takeOldest(db, inventory_ledgers.Take{
		Transaction: order, TeamID: melati, ProductID: kaosHitam, Count: 3, ChangeType: string(models.TxOrder),
	})

	var short *inventory_ledgers.NotEnoughStockError
	if !errors.As(err, &short) || short.Wanted != 3 || short.Available != 2 {
		t.Fatalf("err = %v, want not enough stock: wanted 3, available 2", err)
	}

	if b := batchByID(t, db, batch.ID); b.StockCount != 2 {
		t.Fatalf("batch holds %d after a refused take, want 2", b.StockCount)
	}

	var logs int64
	db.Model(&models.BatchLog{}).Where("transaction_id = ?", order.ID).Count(&logs)
	if logs != 0 {
		t.Fatalf("a refused take wrote %d log rows, want 0", logs)
	}
}

// A take reaches only the owner's batches of the product in the transaction's warehouse.
func TestTakeOldestFirst_OnlyTheOwnersBatchesOfTheProduct(t *testing.T) {
	db := san_testdb.DB(t)

	mint(t, db, sinar, kaosHitam, 9, 10000)
	mint(t, db, melati, kaosPolos, 9, 10000)
	own := mint(t, db, melati, kaosHitam, 1, 10000)

	_, err := takeOldest(db, inventory_ledgers.Take{
		Transaction: transaction(t, db, melati, models.TxOrder),
		TeamID:      melati, ProductID: kaosHitam, Count: 2, ChangeType: string(models.TxOrder),
	})

	var short *inventory_ledgers.NotEnoughStockError
	if !errors.As(err, &short) || short.Available != 1 {
		t.Fatalf("err = %v, want available 1 — only Melati's own Kaos Hitam batch", err)
	}

	if b := batchByID(t, db, own.ID); b.StockCount != 1 {
		t.Fatalf("own batch holds %d, want 1", b.StockCount)
	}
}

// A put creates the rack row at 0 first, then adds, and logs the balance after.
func TestPutOnPlacements_CreatesTheRackRowAndLogsTheBalanceAfter(t *testing.T) {
	db := san_testdb.DB(t)

	rakA := rack(t, db, "rak-a")
	restock := transaction(t, db, melati, models.TxRestock)

	changes, err := inventory_ledgers.PutOnPlacements(db, restock, string(models.TxRestock), ani, "", []inventory_ledgers.Put{
		{TeamID: melati, ProductID: kaosHitam, PlacementID: rakA, Count: 4},
		{TeamID: melati, ProductID: kaosHitam, PlacementID: rakA, Count: 2},
	})
	if err != nil {
		t.Fatalf("PutOnPlacements: %v", err)
	}

	if len(changes) != 1 || changes[0].Change != 6 || changes[0].After != 6 {
		t.Fatalf("changes = %+v, want one row +6, after 6 — two puts on one rack are one row", changes)
	}

	var row models.ProductPlacement
	db.Where("product_id = ? AND placement_id = ?", kaosHitam, rakA).First(&row)
	if row.StockCount != 6 || row.TeamID != melati {
		t.Fatalf("rack row = %+v, want Melati's 6", row)
	}
}

// The rack holding the fewest goes first, a line splits across racks, and the logs carry each rack's balance after.
func TestTakeFewestFirst_TakesTheFewestRackFirstAndSplits(t *testing.T) {
	db := san_testdb.DB(t)

	rakA := rack(t, db, "rak-a")
	rakB := rack(t, db, "rak-b")
	rakC := rack(t, db, "rak-c")

	_, err := inventory_ledgers.PutOnPlacements(db, transaction(t, db, melati, models.TxRestock), string(models.TxRestock), ani, "",
		[]inventory_ledgers.Put{
			{TeamID: melati, ProductID: kaosHitam, PlacementID: rakA, Count: 5},
			{TeamID: melati, ProductID: kaosHitam, PlacementID: rakB, Count: 1},
			{TeamID: melati, ProductID: kaosHitam, PlacementID: rakC, Count: 2},
		})
	if err != nil {
		t.Fatalf("PutOnPlacements: %v", err)
	}

	changes, err := takeFewest(db, transaction(t, db, melati, models.TxOrder), inventory_ledgers.PlacementTake{
		TeamID: melati, ProductID: kaosHitam, Count: 3, ChangeType: string(models.TxOrder), ActorID: ani,
	})
	if err != nil {
		t.Fatalf("TakeFewestFirst: %v", err)
	}

	if len(changes) != 2 || changes[0].PlacementID != rakB || changes[0].Change != -1 ||
		changes[1].PlacementID != rakC || changes[1].Change != -2 || changes[1].After != 0 {
		t.Fatalf("changes = %+v, want Rak B -1 then Rak C -2 to 0", changes)
	}
}

// Too few units across all racks is refused and writes nothing (a-shelf-never-goes-below-zero).
func TestTakeFewestFirst_RefusesBelowZeroAndWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)

	rakA := rack(t, db, "rak-a")

	_, err := inventory_ledgers.PutOnPlacements(db, transaction(t, db, melati, models.TxRestock), string(models.TxRestock), ani, "",
		[]inventory_ledgers.Put{{TeamID: melati, ProductID: kaosHitam, PlacementID: rakA, Count: 1}})
	if err != nil {
		t.Fatalf("PutOnPlacements: %v", err)
	}

	order := transaction(t, db, melati, models.TxOrder)

	_, err = takeFewest(db, order, inventory_ledgers.PlacementTake{
		TeamID: melati, ProductID: kaosHitam, Count: 2, ChangeType: string(models.TxOrder),
	})

	var short *inventory_ledgers.NotEnoughStockError
	if !errors.As(err, &short) || short.Ledger != "placements" || short.Available != 1 {
		t.Fatalf("err = %v, want not enough on the racks: available 1", err)
	}

	var logs int64
	db.Model(&models.ProductPlacementLog{}).Where("transaction_id = ?", order.ID).Count(&logs)
	if logs != 0 {
		t.Fatalf("a refused take wrote %d rack rows, want 0", logs)
	}
}

// An item is owned when its product's owner is the transaction's team — false only on a borrowed order line.
func TestAddItems_IsOwnedFollowsTheOwner(t *testing.T) {
	db := san_testdb.DB(t)

	order := transaction(t, db, melati, models.TxOrder)

	err := inventory_ledgers.AddItems(db, order, []inventory_ledgers.ItemLine{
		{ProductID: kaosHitam, ProductTeamID: melati, Quantity: 1, Total: 10000},
		{ProductID: kaosPolos, ProductTeamID: sinar, Quantity: 2, Total: 24000},
	})
	if err != nil {
		t.Fatalf("AddItems: %v", err)
	}

	var items []models.InventoryTransactionItem
	db.Where("transaction_id = ?", order.ID).Order("product_id").Find(&items)

	if len(items) != 2 || !items[0].IsOwned || items[1].IsOwned {
		t.Fatalf("items = %+v, want Kaos Hitam owned, Kaos Polos borrowed", items)
	}
}

// A restock-shaped transaction — a mint, a put, an item — keeps both invariants; an item that disagrees is caught.
func TestVerify_ABalancedTransactionPassesAndAWrongItemIsCaught(t *testing.T) {
	db := san_testdb.DB(t)

	rakA := rack(t, db, "rak-a")
	restock := transaction(t, db, melati, models.TxRestock)

	_, err := inventory_ledgers.MintBatch(db, inventory_ledgers.Mint{
		Transaction: restock, TeamID: melati, ProductID: kaosHitam, Count: 4, PriceUnit: 11200,
		ChangeType: string(models.TxRestock), ActorID: ani,
	})
	if err != nil {
		t.Fatalf("MintBatch: %v", err)
	}

	_, err = inventory_ledgers.PutOnPlacements(db, restock, string(models.TxRestock), ani, "",
		[]inventory_ledgers.Put{{TeamID: melati, ProductID: kaosHitam, PlacementID: rakA, Count: 4}})
	if err != nil {
		t.Fatalf("PutOnPlacements: %v", err)
	}

	err = inventory_ledgers.AddItems(db, restock, []inventory_ledgers.ItemLine{
		{ProductID: kaosHitam, ProductTeamID: melati, Quantity: 4, Total: 44800},
	})
	if err != nil {
		t.Fatalf("AddItems: %v", err)
	}

	err = inventory_ledgers.Verify(db, restock.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	db.Model(&models.InventoryTransactionItem{}).Where("transaction_id = ?", restock.ID).Update("total", 40000)

	err = inventory_ledgers.Verify(db, restock.ID)
	if err == nil {
		t.Fatal("Verify passed an item whose total disagrees with its batch rows")
	}
}
