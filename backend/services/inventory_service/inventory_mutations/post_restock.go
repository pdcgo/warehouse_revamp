package inventory_mutations

import (
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockLine is one accepted restock line: its good units, the price they landed at, and where they were put.
type RestockLine struct {
	ProductID uint64
	// received − broken. A line with none mints nothing.
	Good int64
	// The landed unit price (unit-price-is-line-price-plus-costs-per-unit).
	PriceUnit         float64
	SupplierID        uint64
	SupplierChannelID uint64
	// Where the good units went; together they hold exactly Good (there-is-no-unplaced-pile).
	Placements []RestockPlacement
}

// RestockPlacement is good units put on one rack at the accept — the accept's own rack rows, never a move
// (putting-away-at-accept-is-not-a-move).
type RestockPlacement struct {
	PlacementID uint64
	Count       int64
}

// Restock is an accepted restock: the warehouse it landed in, the team that owns the goods, who counted it in.
type Restock struct {
	WarehouseID uint64
	// The requesting selling team — the owner of every batch minted (a-batch-carries-its-owner).
	TeamID  uint64
	ActorID uint64
	Lines   []RestockLine
}

// LandedPrice is a restock line's unit price: the line's price per unit ordered, plus every cost of getting the box
// here spread over every unit ordered across the restock (unit-price-is-line-price-plus-costs-per-unit,
// all-qty-is-every-unit-ordered). Kept as float — a fraction of a rupiah is stored as is
// (stock-money-is-float64-compared-at-4-digits).
func LandedPrice(lineTotal float64, lineCount int64, costs float64, allQty int64) float64 {
	if lineCount <= 0 {
		return 0
	}

	price := lineTotal / float64(lineCount)
	if allQty > 0 {
		price += costs / float64(allQty)
	}

	return price
}

// PostRestock writes an accepted restock into the ledgers: one `restock` transaction owned by the requesting team, ONE
// BATCH PER LINE with good units at its landed price (one-batch-per-line), the good units on the racks named, and one
// item per product equal to its batch (an-item-equals-its-batch-rows). A restock with no good unit at all still gets
// its transaction: the act happened (a-transaction-is-made-when-the-act-happens).
func PostRestock(tx *gorm.DB, r Restock) (models.InventoryTransaction, error) {
	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: r.WarehouseID,
		TeamID:      r.TeamID,
		TxType:      models.TxRestock,
		ActorID:     r.ActorID,
	})
	if err != nil {
		return t, err
	}

	mints := make([]inventory_ledgers.Mint, 0, len(r.Lines))
	puts := make([]inventory_ledgers.Put, 0, len(r.Lines))

	// BATCHES FIRST, then racks (batches-lock-before-shelves-by-id) — every line's batch written at once
	// (ledger-writes-are-set-based).
	for _, line := range r.Lines {
		if line.Good <= 0 {
			continue
		}

		var placed int64
		for _, p := range line.Placements {
			placed += p.Count
			puts = append(puts, inventory_ledgers.Put{
				TeamID: r.TeamID, ProductID: line.ProductID, PlacementID: p.PlacementID, Count: p.Count,
			})
		}

		if placed != line.Good {
			return t, fmt.Errorf("restock of product %d: %d good units, %d placed", line.ProductID, line.Good, placed)
		}

		mints = append(mints, inventory_ledgers.Mint{
			Transaction:       t,
			TeamID:            r.TeamID,
			ProductID:         line.ProductID,
			Count:             line.Good,
			PriceUnit:         line.PriceUnit,
			SupplierID:        line.SupplierID,
			SupplierChannelID: line.SupplierChannelID,
			ChangeType:        string(models.TxRestock),
			ActorID:           r.ActorID,
		})
	}

	batches, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return t, err
	}

	items := make([]inventory_ledgers.ItemLine, 0, len(batches))
	for _, batch := range batches {
		items = append(items, inventory_ledgers.ItemLine{
			ProductID:     batch.ProductID,
			ProductTeamID: r.TeamID,
			Quantity:      batch.InitStockCount,
			Total:         batch.InitStockValuation,
		})
	}

	_, err = inventory_ledgers.PutOnPlacements(tx, t, string(models.TxRestock), r.ActorID, "", puts)
	if err != nil {
		return t, err
	}

	err = inventory_ledgers.AddItems(tx, t, items)
	if err != nil {
		return t, err
	}

	return t, nil
}
