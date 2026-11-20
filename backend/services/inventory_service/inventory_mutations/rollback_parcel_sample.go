package inventory_mutations

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ErrNotARequestedParcelSample refuses undoing anything but the take of a custom shipment's SAMPLE that is still
// REQUESTED: a sample handed over at the warehouse is final (a-handed-over-sample-is-final), and so is a parcel once the
// warehouse picked it (a-custom-shipment-is-cancelled-only-while-requested).
var ErrNotARequestedParcelSample = errors.New("only a requested custom shipment's sample take is undone")

// RollbackParcelSample undoes the stock take of ONE custom shipment's sample, once — the selling team calling the parcel
// off while it is REQUESTED puts its units back on the batches and the racks they left
// (a-custom-shipment-is-cancelled-only-while-requested; the 🔄 2026-11-19 line on a-rollback-only-undoes-a-take).
//
// It is RollbackTake's sibling, not a widening of RollbackTake's guard: RollbackTake still refuses every `sample`, so no
// later caller of it can undo an in-person sample. This one reaches a take only THROUGH the parcel that names it, and
// only while that parcel is a requested sample — an in-person sample has no parcel, and a picked one is refused.
//
// Locks, in order: the parcel row (`FOR UPDATE` — a no-op when the caller already holds it, as the cancel does), the
// transaction row, then the batches and the racks in id order (batches-lock-before-shelves-by-id) — the transfer
// cancel's order. A take already rolled back does nothing and answers false. A rack a stock count holds refuses the whole
// undo with a *CountedError (a-lock-stops-sales-and-cancels-too). The items stay: what the take did is still true.
func RollbackParcelSample(tx *gorm.DB, shipmentID, actorID uint64) (bool, error) {
	var parcel models.CustomShipment

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&parcel, shipmentID).
		Error
	if err != nil {
		return false, fmt.Errorf("lock custom shipment %d: %w", shipmentID, err)
	}

	if parcel.Kind != models.CustomShipmentSample || parcel.Status != models.CustomShipmentRequested ||
		parcel.TransactionID == nil {
		return false, fmt.Errorf("%w: custom shipment %d is a %s, %s", ErrNotARequestedParcelSample, parcel.ID, parcel.Kind,
			parcel.Status)
	}

	var t models.InventoryTransaction

	err = tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&t, *parcel.TransactionID).
		Error
	if err != nil {
		return false, fmt.Errorf("lock transaction %d: %w", *parcel.TransactionID, err)
	}

	if t.IsRollback {
		return false, nil
	}

	// The parcel's own take, of its own team in its own warehouse — anything else is not this parcel's to undo.
	if t.TxType != models.TxSample || t.TeamID != parcel.TeamID || t.WarehouseID != parcel.WarehouseID {
		return false, fmt.Errorf("%w: transaction %d is a %s of team %d at %d", ErrNotARequestedParcelSample, t.ID, t.TxType,
			t.TeamID, t.WarehouseID)
	}

	err = reverseTake(tx, t, actorID)
	if err != nil {
		return false, err
	}

	return true, nil
}
