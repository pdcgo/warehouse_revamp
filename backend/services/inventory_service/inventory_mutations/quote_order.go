package inventory_mutations

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
)

// QuotedLine is what PostOrder WOULD draw for one line: the owner's units in the warehouse and, when they are enough,
// the batches the take would give them from, oldest first.
type QuotedLine struct {
	ProductID   uint64
	OwnerTeamID uint64
	Quantity    int64
	// The owner's units of the product in the warehouse — what the take counts the line against (refuseShortLines).
	Available int64
	// The batches the take would draw, oldest first, each with the units and the value it would give up. EMPTY when
	// Available < Quantity: the take refuses a short line and draws nothing for it, so there is no cost to answer.
	Batches []inventory_ledgers.BatchTaken
}

// QuoteOrder answers what PostOrder would draw for each line, WITHOUT a lock or a write — the order form's preview of
// what leaves the shelf (an-order-is-costed-at-what-leaves-the-shelf). It is PostOrder's own path with the writes taken
// out: the same lines in the same order, the same batches read by the same statement (ReadBatches is LockBatches
// without FOR UPDATE), each line counted the same way (Available) and drawn by the same selection
// (inventory_ledgers.DrawOldestFirst). So the preview and the take cannot disagree about WHICH units leave — only about
// WHEN: another order may take them first, and then the order freezes the draw it really made.
//
// A short line is REPORTED, not refused: the take refuses every short line together, but a form that is still being
// typed needs every line's answer, short ones included. The racks are not read — where a unit sits never changes what
// it cost.
func QuoteOrder(db *gorm.DB, o Order) ([]QuotedLine, error) {
	lines := sortedByProduct(o.Lines)

	batches, err := inventory_ledgers.ReadBatches(db, o.WarehouseID, ownersOf(lines))
	if err != nil {
		return nil, err
	}

	quoted := make([]QuotedLine, 0, len(lines))

	for _, line := range lines {
		q := QuotedLine{
			ProductID:   line.ProductID,
			OwnerTeamID: line.OwnerTeamID,
			Quantity:    line.Quantity,
			Available:   batches.Available(line.OwnerTeamID, line.ProductID),
		}

		if q.Available >= line.Quantity {
			q.Batches, err = inventory_ledgers.DrawOldestFirst(batches, line.OwnerTeamID, line.ProductID, line.Quantity)
			if err != nil {
				return nil, err
			}
		}

		quoted = append(quoted, q)
	}

	return quoted, nil
}
