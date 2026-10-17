package inventory_mutations

import (
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// PROVISIONAL ADJUSTMENTS (old-shelf-corrections-move-onto-the-ledgers-provisionally): `StockAdjust` and the one-rack
// `StockOpname` kept through the cut-over as `adjustment` transactions, one per owning team. Every choice made here is
// listed in docs/business/inventory/adjustment_clarify.md for the owner to confirm or reverse; the real adjustment and
// the stock count replace them when designed.

var (
	// ErrNeverStockedHere refuses a surplus of a product this warehouse never held: it has no owner to give it to, and
	// it comes in by its team's restock (a-box-nobody-raised-comes-in-by-the-teams-restock).
	ErrNeverStockedHere = errors.New("this product has never been in this warehouse — it comes in by its team's restock")
	// ErrBatchNotHere refuses a batch of another warehouse or another product.
	ErrBatchNotHere = errors.New("batch not found for this product in this warehouse")
)

// RecountLine is one product counted on the rack.
type RecountLine struct {
	ProductID uint64
	Counted   int64
}

// Recount is one rack counted: each line corrects the rack TO its counted figure.
type Recount struct {
	WarehouseID uint64
	PlacementID uint64
	ActorID     uint64
	Description string
	Lines       []RecountLine
}

// RecountedLine is what one line found.
type RecountedLine struct {
	ProductID   uint64
	OwnerTeamID uint64
	// 0 for a product nobody owns here, counted at 0 — nothing was written for it.
	TransactionID uint64
	Expected      int64
	Counted       int64
	// The shortfall's value taken off the batches, or the surplus's minted value; 0 for an exact count.
	Value float64
}

// PostRecount corrects ONE rack to the counted figures, all lines in one database transaction:
//
//   - short: the units leave the rack, and the owner's batches oldest first, at their value;
//   - over: the units go on the rack, minted as one batch at the owner's newest batch price here (0 when none);
//   - exact: a rack row of 0, so the rack reads as counted.
//
// Every line's batches are locked in one statement before the racks (batches-lock-before-shelves-by-id), lines in
// product order, and each ledger is written once for all of them (ledger-writes-are-set-based).
func PostRecount(tx *gorm.DB, r Recount) ([]models.InventoryTransaction, []RecountedLine, error) {
	lines := append([]RecountLine(nil), r.Lines...)
	sort.Slice(lines, func(i, j int) bool { return lines[i].ProductID < lines[j].ProductID })

	ids := make([]uint64, 0, len(lines))
	for _, line := range lines {
		ids = append(ids, line.ProductID)
	}

	ownerOf, err := ownersHere(tx, r.WarehouseID, ids)
	if err != nil {
		return nil, nil, err
	}

	out := make([]RecountedLine, 0, len(lines))
	rows := make([]inventory_ledgers.RackRowToEnsure, 0, len(lines))
	owners := make([]inventory_ledgers.ProductOwner, 0, len(lines))

	for _, line := range lines {
		owner, found := ownerOf[line.ProductID]
		if !found {
			if line.Counted > 0 {
				return nil, nil, fmt.Errorf("%w: product %d", ErrNeverStockedHere, line.ProductID)
			}

			out = append(out, RecountedLine{ProductID: line.ProductID})

			continue
		}

		out = append(out, RecountedLine{ProductID: line.ProductID, OwnerTeamID: owner, Counted: line.Counted})
		owners = append(owners, inventory_ledgers.ProductOwner{TeamID: owner, ProductID: line.ProductID})
		rows = append(rows, inventory_ledgers.RackRowToEnsure{
			RackKey: inventory_ledgers.RackKey{ProductID: line.ProductID, PlacementID: r.PlacementID},
			TeamID:  owner,
		})
	}

	// The owners' batches, locked before any rack.
	locked, err := inventory_ledgers.LockBatches(tx, r.WarehouseID, owners)
	if err != nil {
		return nil, nil, err
	}

	racks, err := inventory_ledgers.EnsureAndLockRacks(tx, r.WarehouseID, rows)
	if err != nil {
		return nil, nil, err
	}

	// What each line found, before anything is written: a surplus needs its owner's newest price.
	var surplus []inventory_ledgers.ProductOwner

	for i := range out {
		line := &out[i]
		if line.OwnerTeamID == 0 {
			continue
		}

		line.Expected = racks[inventory_ledgers.RackKey{ProductID: line.ProductID, PlacementID: r.PlacementID}].StockCount
		if line.Counted > line.Expected {
			surplus = append(surplus, inventory_ledgers.ProductOwner{TeamID: line.OwnerTeamID, ProductID: line.ProductID})
		}
	}

	prices, err := newestPricesHere(tx, r.WarehouseID, surplus)
	if err != nil {
		return nil, nil, err
	}

	change := string(models.TxAdjustment)
	txOf := map[uint64]models.InventoryTransaction{}

	var batchWrites inventory_ledgers.BatchWrites
	var rackWrites inventory_ledgers.RackWrites

	mints := make([]inventory_ledgers.Mint, 0, len(surplus))
	mintedLine := make([]int, 0, len(surplus))

	for i := range out {
		line := &out[i]
		if line.OwnerTeamID == 0 {
			continue
		}

		t, ok := txOf[line.OwnerTeamID]
		if !ok {
			t, err = inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
				WarehouseID: r.WarehouseID,
				TeamID:      line.OwnerTeamID,
				TxType:      models.TxAdjustment,
				ActorID:     r.ActorID,
				Description: r.Description,
			})
			if err != nil {
				return nil, nil, err
			}

			txOf[line.OwnerTeamID] = t
		}

		line.TransactionID = t.ID
		delta := line.Counted - line.Expected

		switch {
		case delta < 0:
			taken, takeErr := inventory_ledgers.TakeOldestFirst(locked, &batchWrites, inventory_ledgers.Take{
				Transaction: t, TeamID: line.OwnerTeamID, ProductID: line.ProductID, Count: -delta,
				ChangeType: change, ActorID: r.ActorID, Description: r.Description,
			})
			if takeErr != nil {
				return nil, nil, takeErr
			}

			_, line.Value = inventory_ledgers.TotalTaken(taken)
		case delta > 0:
			mints = append(mints, inventory_ledgers.Mint{
				Transaction: t, TeamID: line.OwnerTeamID, ProductID: line.ProductID, Count: delta,
				PriceUnit:  prices[inventory_ledgers.ProductOwner{TeamID: line.OwnerTeamID, ProductID: line.ProductID}],
				ChangeType: change, ActorID: r.ActorID, Description: r.Description,
			})
			mintedLine = append(mintedLine, i)
		}

		row := racks[inventory_ledgers.RackKey{ProductID: line.ProductID, PlacementID: r.PlacementID}]

		_, applyErr := rackWrites.Apply(t, row, delta, change, r.ActorID, r.Description)
		if applyErr != nil {
			return nil, nil, applyErr
		}
	}

	err = batchWrites.Flush(tx)
	if err != nil {
		return nil, nil, err
	}

	batches, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return nil, nil, err
	}

	for j, b := range batches {
		out[mintedLine[j]].Value = b.StockValuation
	}

	err = rackWrites.Flush(tx)
	if err != nil {
		return nil, nil, err
	}

	itemsOf := map[uint64][]inventory_ledgers.ItemLine{}

	for _, line := range out {
		if line.OwnerTeamID == 0 {
			continue
		}

		itemsOf[line.OwnerTeamID] = append(itemsOf[line.OwnerTeamID], inventory_ledgers.ItemLine{
			ProductID:     line.ProductID,
			ProductTeamID: line.OwnerTeamID,
			Quantity:      abs64(line.Counted - line.Expected),
			Total:         line.Value,
		})
	}

	teams := make([]uint64, 0, len(txOf))
	for team := range txOf {
		teams = append(teams, team)
	}

	sort.Slice(teams, func(i, j int) bool { return teams[i] < teams[j] })

	posted := make([]models.InventoryTransaction, 0, len(teams))

	for _, team := range teams {
		err = inventory_ledgers.AddItems(tx, txOf[team], itemsOf[team])
		if err != nil {
			return nil, nil, err
		}

		posted = append(posted, txOf[team])
	}

	return posted, out, nil
}

// BatchAdjust is units of ONE named batch, on one rack, broken, lost or found.
type BatchAdjust struct {
	WarehouseID uint64
	ProductID   uint64
	PlacementID uint64
	BatchID     uint64
	Count       int64
	// True returns the units to the batch and the rack; false takes them off both.
	Found       bool
	ActorID     uint64
	Description string
}

// BatchAdjusted is what a batch adjust moved.
type BatchAdjusted struct {
	Transaction models.InventoryTransaction
	OwnerTeamID uint64
	// The value taken or returned, at the batch's own value.
	Value float64
	// The rack's count after.
	RackAfter int64
}

// PostBatchAdjust writes one `adjustment` of the batch's owner: the named batch first, then the rack — refused when the
// batch or the rack holds too few.
func PostBatchAdjust(tx *gorm.DB, a BatchAdjust) (BatchAdjusted, error) {
	var batch models.Batch

	err := tx.Where("id = ? AND warehouse_id = ? AND product_id = ?", a.BatchID, a.WarehouseID, a.ProductID).
		Take(&batch).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BatchAdjusted{}, ErrBatchNotHere
	}

	if err != nil {
		return BatchAdjusted{}, fmt.Errorf("read batch %d: %w", a.BatchID, err)
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: a.WarehouseID,
		TeamID:      batch.TeamID,
		TxType:      models.TxAdjustment,
		ActorID:     a.ActorID,
		Description: a.Description,
	})
	if err != nil {
		return BatchAdjusted{}, err
	}

	change := inventory_ledgers.BatchChange{
		Transaction: t, BatchID: a.BatchID, Count: a.Count,
		ChangeType: string(models.TxAdjustment), ActorID: a.ActorID, Description: a.Description,
	}

	var moved inventory_ledgers.BatchTaken

	if a.Found {
		moved, err = inventory_ledgers.AddToBatch(tx, change)
	} else {
		moved, err = inventory_ledgers.TakeFromBatch(tx, change)
	}

	if err != nil {
		return BatchAdjusted{}, err
	}

	racks, err := inventory_ledgers.EnsureAndLockRacks(tx, a.WarehouseID, []inventory_ledgers.RackRowToEnsure{{
		RackKey: inventory_ledgers.RackKey{ProductID: a.ProductID, PlacementID: a.PlacementID},
		TeamID:  batch.TeamID,
	}})
	if err != nil {
		return BatchAdjusted{}, err
	}

	delta := a.Count
	if !a.Found {
		delta = -a.Count
	}

	row := racks[inventory_ledgers.RackKey{ProductID: a.ProductID, PlacementID: a.PlacementID}]

	var w inventory_ledgers.RackWrites

	rack, err := w.Apply(t, row, delta, string(models.TxAdjustment), a.ActorID, a.Description)
	if err != nil {
		return BatchAdjusted{}, err
	}

	err = w.Flush(tx)
	if err != nil {
		return BatchAdjusted{}, err
	}

	err = inventory_ledgers.AddItems(tx, t, []inventory_ledgers.ItemLine{{
		ProductID: a.ProductID, ProductTeamID: batch.TeamID, Quantity: a.Count, Total: moved.Valuation,
	}})
	if err != nil {
		return BatchAdjusted{}, err
	}

	return BatchAdjusted{Transaction: t, OwnerTeamID: batch.TeamID, Value: moved.Valuation, RackAfter: rack.After}, nil
}

// ownersHere is who owns each product's stock in this warehouse: the team of its newest batch. A product has one owner;
// one never stocked here is absent.
func ownersHere(tx *gorm.DB, warehouseID uint64, productIDs []uint64) (map[uint64]uint64, error) {
	out := map[uint64]uint64{}
	if len(productIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		ProductID uint64
		TeamID    uint64
	}

	err := tx.Raw(`
		SELECT DISTINCT ON (product_id) product_id, team_id
		FROM batches
		WHERE warehouse_id = ? AND product_id IN ?
		ORDER BY product_id, id DESC`, warehouseID, productIDs).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("owners of %d product(s): %w", len(productIDs), err)
	}

	for _, r := range rows {
		out[r.ProductID] = r.TeamID
	}

	return out, nil
}

// newestPricesHere is each owner's newest batch price for the product in this warehouse; an owner with none is absent,
// so it reads 0 (last-price-is-the-teams-newest-batch-here).
func newestPricesHere(
	tx *gorm.DB,
	warehouseID uint64,
	owners []inventory_ledgers.ProductOwner,
) (map[inventory_ledgers.ProductOwner]float64, error) {
	out := map[inventory_ledgers.ProductOwner]float64{}
	if len(owners) == 0 {
		return out, nil
	}

	pairs := make([][]any, 0, len(owners))
	for _, o := range owners {
		pairs = append(pairs, []any{o.TeamID, o.ProductID})
	}

	var rows []struct {
		TeamID    uint64
		ProductID uint64
		PriceUnit float64
	}

	err := tx.Raw(`
		SELECT DISTINCT ON (team_id, product_id) team_id, product_id, price_unit
		FROM batches
		WHERE warehouse_id = ? AND (team_id, product_id) IN ?
		ORDER BY team_id, product_id, id DESC`, warehouseID, pairs).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("newest prices of %d product(s): %w", len(owners), err)
	}

	for _, r := range rows {
		out[inventory_ledgers.ProductOwner{TeamID: r.TeamID, ProductID: r.ProductID}] = r.PriceUnit
	}

	return out, nil
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}

	return v
}
