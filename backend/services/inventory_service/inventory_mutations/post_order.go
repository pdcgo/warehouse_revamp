package inventory_mutations

import (
	"fmt"
	"sort"
	"strings"
	"time"

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
	TeamID     uint64
	ActorID    uint64
	IsOverride bool
	Lines      []OrderLine
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

// CountedLine is one line of a take the racks NO count holds cannot fill: what it wanted, what those racks hold, and the
// count holding the rest.
type CountedLine struct {
	ProductID uint64
	Wanted    int64
	Free      int64
	Lock      inventory_ledgers.CountLock
}

// CountedLinesError refuses a take — an order's or a transfer's out-leg — because a stock count holds units it would need
// (a-lock-stops-sales-and-cancels-too). It names every such line, and each line's count, so the person knows whom to ask
// (an-abandoned-count-waits-for-the-admin).
type CountedLinesError struct {
	Lines []CountedLine
}

func (e *CountedLinesError) Error() string {
	parts := make([]string, 0, len(e.Lines))
	for _, l := range e.Lines {
		parts = append(parts, fmt.Sprintf("product %d wants %d, %d on racks no count holds — the rest is held on rack %s by count #%d, started by user #%d at %s",
			l.ProductID, l.Wanted, l.Free, l.Lock.PlacementCode, l.Lock.SessionID, l.Lock.StartedByID,
			l.Lock.StartedAt.In(wib).Format("2006-01-02 15:04 MST")))
	}

	return fmt.Sprintf("%d line(s) need units a stock count holds: %s; they are released when the count is finalized or cancelled",
		len(e.Lines), strings.Join(parts, "; "))
}

// Unwrap is the first line's lock, so a caller that only asks "was this a count?" (errors.As a *CountedError) is answered.
func (e *CountedLinesError) Unwrap() error {
	if len(e.Lines) == 0 {
		return nil
	}

	return &inventory_ledgers.CountedError{CountLock: e.Lines[0].Lock}
}

// wib is the warehouse's clock, for a refusal a person reads.
var wib = time.FixedZone("WIB", 7*60*60)

// refuseCountedLines checks every line against the racks no count holds, from the locked rack rows, BEFORE any rack is
// written — so the refusal names every line a count blocks, not only the first.
func refuseCountedLines(racks *inventory_ledgers.LockedRacks, lines []OrderLine) error {
	var counted []CountedLine

	for _, line := range lines {
		free, held := racks.Free(line.OwnerTeamID, line.ProductID)

		if free < line.Quantity && held != nil {
			counted = append(counted, CountedLine{ProductID: line.ProductID, Wanted: line.Quantity, Free: free, Lock: *held})
		}
	}

	if len(counted) > 0 {
		return &CountedLinesError{Lines: counted}
	}

	return nil
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
		IsOverride:  o.IsOverride,
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

	// A rack a stock count holds is never taken from (a-lock-stops-sales-and-cancels-too): every line is checked against
	// the other racks first, and the refusal names each line and its count.
	err = refuseCountedLines(racks, lines)
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
