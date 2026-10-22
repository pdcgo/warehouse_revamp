package inventory_mutations

import (
	"fmt"
	"sort"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OrderLine is one product an order takes.
type OrderLine struct {
	ProductID uint64
	// The product's owner — whose batches and racks give the units.
	OwnerTeamID uint64
	Quantity    int64
}

// Order is an order's take in one warehouse.
type Order struct {
	WarehouseID uint64
	// The ORDERING team — the transaction's team (an-order-transaction-is-the-ordering-teams).
	TeamID  uint64
	ActorID uint64
	Lines   []OrderLine
}

// TakenLine is what one line took: its units and the value its owner's batches gave up.
type TakenLine struct {
	ProductID   uint64
	OwnerTeamID uint64
	Quantity    int64
	Value       float64
}

// ShortLinesError refuses a take that wants more than the warehouse holds, naming EVERY short line
// (a-refusal-names-its-reason-and-every-line). Nothing was written.
type ShortLinesError struct {
	Lines []inventory_ledgers.NotEnoughStockError
}

func (e *ShortLinesError) Error() string {
	return fmt.Sprintf("not enough stock for %d line(s)", len(e.Lines))
}

// PostOrder writes an order's take: ONE `order` transaction of the ordering team, even across owners
// (an-order-is-one-inventory-transaction); per line the owner's batches oldest first and racks holding the fewest first
// (an-order-takes-from-the-lowest-shelf-first); one item per product equal to its batch rows.
//
// Every line's batches are locked and counted in ONE statement BEFORE anything is written, so a refusal names every
// short line and writes nothing. Batches are locked before racks, each in id order, so two orders queue on the same rows
// in the same order (batches-lock-before-shelves-by-id).
func PostOrder(tx *gorm.DB, o Order) (models.InventoryTransaction, []TakenLine, error) {
	lines := sortedByProduct(o.Lines)

	locked, err := inventory_ledgers.LockBatches(tx, o.WarehouseID, ownersOf(lines))
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	err = refuseShortLines(locked, lines)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: o.WarehouseID,
		TeamID:      o.TeamID,
		TxType:      models.TxOrder,
		ActorID:     o.ActorID,
	})
	if err != nil {
		return t, nil, err
	}

	taken, err := takeLines(tx, t, locked, lines, o.ActorID, "")
	if err != nil {
		return t, nil, err
	}

	return t, taken, nil
}

func sortedByProduct(lines []OrderLine) []OrderLine {
	sorted := append([]OrderLine(nil), lines...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ProductID < sorted[j].ProductID })

	return sorted
}

func ownersOf(lines []OrderLine) []inventory_ledgers.ProductOwner {
	owners := make([]inventory_ledgers.ProductOwner, 0, len(lines))
	for _, line := range lines {
		owners = append(owners, inventory_ledgers.ProductOwner{TeamID: line.OwnerTeamID, ProductID: line.ProductID})
	}

	return owners
}

// refuseShortLines counts every line from the locked batches, in the order given, and refuses naming every short one.
func refuseShortLines(locked *inventory_ledgers.LockedBatches, lines []OrderLine) error {
	var short []inventory_ledgers.NotEnoughStockError

	for _, line := range lines {
		available := locked.Available(line.OwnerTeamID, line.ProductID)

		if available < line.Quantity {
			short = append(short, inventory_ledgers.NotEnoughStockError{
				ProductID: line.ProductID, Wanted: line.Quantity, Available: available, Ledger: "batches",
			})
		}
	}

	if len(short) > 0 {
		return &ShortLinesError{Lines: short}
	}

	return nil
}

// takeLines is a take's writes, once every line is known to fit: the owners' locked batches oldest first for EVERY
// line, stored in one update and one log insert; then their racks, locked in one statement, fewest first for every line,
// stored the same way; then one item per product equal to its batch rows (ledger-writes-are-set-based). The change type
// is the transaction's own.
func takeLines(
	tx *gorm.DB,
	t models.InventoryTransaction,
	locked *inventory_ledgers.LockedBatches,
	lines []OrderLine,
	actorID uint64,
	description string,
) ([]TakenLine, error) {
	taken := make([]TakenLine, 0, len(lines))
	items := make([]inventory_ledgers.ItemLine, 0, len(lines))

	// BATCHES, every line...
	var batchWrites inventory_ledgers.BatchWrites

	for _, line := range lines {
		batches, err := inventory_ledgers.TakeOldestFirst(locked, &batchWrites, inventory_ledgers.Take{
			Transaction: t,
			TeamID:      line.OwnerTeamID,
			ProductID:   line.ProductID,
			Count:       line.Quantity,
			ChangeType:  string(t.TxType),
			ActorID:     actorID,
			Description: description,
		})
		if err != nil {
			return nil, err
		}

		count, value := inventory_ledgers.TotalTaken(batches)

		taken = append(taken, TakenLine{ProductID: line.ProductID, OwnerTeamID: line.OwnerTeamID, Quantity: count, Value: value})
		items = append(items, inventory_ledgers.ItemLine{
			ProductID: line.ProductID, ProductTeamID: line.OwnerTeamID, Quantity: count, Total: value,
		})
	}

	err := batchWrites.Flush(tx)
	if err != nil {
		return nil, err
	}

	// ...then RACKS, every line.
	racks, err := inventory_ledgers.LockRacks(tx, t.WarehouseID, ownersOf(lines))
	if err != nil {
		return nil, err
	}

	var rackWrites inventory_ledgers.RackWrites

	for _, line := range lines {
		_, err = inventory_ledgers.TakeFewestFirst(racks, &rackWrites, t, inventory_ledgers.PlacementTake{
			TeamID:      line.OwnerTeamID,
			ProductID:   line.ProductID,
			Count:       line.Quantity,
			ChangeType:  string(t.TxType),
			ActorID:     actorID,
			Description: description,
		})
		if err != nil {
			return nil, err
		}
	}

	err = rackWrites.Flush(tx)
	if err != nil {
		return nil, err
	}

	err = inventory_ledgers.AddItems(tx, t, items)
	if err != nil {
		return nil, err
	}

	return taken, nil
}
