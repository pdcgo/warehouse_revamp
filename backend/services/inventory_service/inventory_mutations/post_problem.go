package inventory_mutations

import (
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A REPORT AT THE SHELF — the register's second door (an-adjustment-writes-the-same-problem-row). A carton dropped at
// 10:00, outside any count, is the same fact a count's finalize records: a `problem` transaction of the batch's owner
// (problem-and-found-replace-opname), its batch and rack rows saying broken or lost, and ONE warehouse_stock_problems row
// at the batch's price — claimable for a lost unit, never for a broken one (a-broken-unit-is-thrown-away). It names its
// rack (a-problem-row-names-its-rack) and keeps its note as written (a-problem-note-names-its-racks). No session lists
// the transaction, which is what tells this door from a count's.
//
// The Adjust screen still names the batch the report is about, as it always has: the finished adjustment's shape is the
// owner's adjustment.md, still empty.

// ShelfProblem is units of ONE named batch, on one rack, found broken or lost.
type ShelfProblem struct {
	WarehouseID uint64
	ProductID   uint64
	PlacementID uint64
	BatchID     uint64
	Count       int64
	Type        models.ProblemType
	ActorID     uint64
	IsOverride  bool
	Description string
}

// ShelfProblemPosted is what the report wrote.
type ShelfProblemPosted struct {
	Transaction models.InventoryTransaction
	OwnerTeamID uint64
	ProblemID   uint64
	// The value the batch gave up.
	Value float64
	// The rack's count after.
	RackAfter int64
}

// PostShelfProblem writes the report: the batch locked and taken from first, then the rack — refused when either holds
// too few, or when a count holds the product on that rack (a-lock-stops-units-moving-not-sales).
func PostShelfProblem(tx *gorm.DB, p ShelfProblem) (ShelfProblemPosted, error) {
	if p.Type != models.ProblemBroken && p.Type != models.ProblemLost {
		return ShelfProblemPosted{}, fmt.Errorf("a shelf problem is broken or lost, not %q", p.Type)
	}

	var batch models.Batch

	err := tx.Where("id = ? AND warehouse_id = ? AND product_id = ?", p.BatchID, p.WarehouseID, p.ProductID).
		Take(&batch).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ShelfProblemPosted{}, ErrBatchNotHere
	}

	if err != nil {
		return ShelfProblemPosted{}, fmt.Errorf("read batch %d: %w", p.BatchID, err)
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: p.WarehouseID,
		TeamID:      batch.TeamID,
		TxType:      models.TxProblem,
		ActorID:     p.ActorID,
		IsOverride:  p.IsOverride,
		Description: p.Description,
	})
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	taken, err := inventory_ledgers.TakeFromBatch(tx, inventory_ledgers.BatchChange{
		Transaction: t, BatchID: p.BatchID, Count: p.Count,
		ChangeType: string(p.Type), ActorID: p.ActorID, Description: p.Description,
	})
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	key := inventory_ledgers.RackKey{ProductID: p.ProductID, PlacementID: p.PlacementID}

	racks, err := inventory_ledgers.EnsureAndLockRacks(tx, p.WarehouseID, []inventory_ledgers.RackRowToEnsure{{
		RackKey: key, TeamID: batch.TeamID,
	}})
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	err = inventory_ledgers.RefuseCounted(tx, []inventory_ledgers.RackKey{key})
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	var w inventory_ledgers.RackWrites

	rack, err := w.Apply(t, racks[key], -p.Count, string(p.Type), p.ActorID, p.Description)
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	err = w.Flush(tx)
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	placement := p.PlacementID
	row := models.WarehouseStockProblem{
		WarehouseID: p.WarehouseID, TeamID: batch.TeamID, ProductID: p.ProductID, TransactionID: t.ID,
		BatchID: p.BatchID, PlacementID: &placement, Note: p.Description, ProblemType: p.Type,
		ProblemStockCount: p.Count, PriceUnit: batch.PriceUnit,
	}

	if p.Type == models.ProblemLost {
		row.ClaimableStockCount = p.Count
	}

	err = tx.Create(&row).Error
	if err != nil {
		return ShelfProblemPosted{}, fmt.Errorf("stock problem: %w", err)
	}

	err = inventory_ledgers.AddItems(tx, t, []inventory_ledgers.ItemLine{{
		ProductID: p.ProductID, ProductTeamID: batch.TeamID, Quantity: p.Count, Total: taken.Valuation,
	}})
	if err != nil {
		return ShelfProblemPosted{}, err
	}

	return ShelfProblemPosted{
		Transaction: t, OwnerTeamID: batch.TeamID, ProblemID: row.ID, Value: taken.Valuation, RackAfter: rack.After,
	}, nil
}
