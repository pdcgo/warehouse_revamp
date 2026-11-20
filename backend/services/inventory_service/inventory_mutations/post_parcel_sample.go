package inventory_mutations

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A SAMPLE SENT BY PARCEL — a custom shipment's sample (docs/business/custom_shipments/context_decision.md). Its units
// leave stock AT CREATE, oldest batch first, from racks the SYSTEM picks (the-custom-shipments-prototype-is-accepted;
// the principle row of a-sample-names-the-rack-it-was-taken-from: the act is recorded before anyone is at the shelf).
// That is exactly a transfer's out-leg — so it is written by the same code (refuseShortLines, takeLines), only typed
// `sample` and carrying its recipient (a-sample-is-a-stock-out-at-batch-value, a-sample-keeps-its-recipient). The
// in-person sample, from ONE rack staff name, stays PostSample.

// ParcelSample is a custom shipment's sample take in one warehouse.
type ParcelSample struct {
	WarehouseID uint64
	// The selling team that owns every unit sent — the transaction's team.
	TeamID      uint64
	ActorID     uint64
	IsOverride  bool
	Recipient   string
	Description string
	Lines       []TransferLine
}

// PostParcelSample writes ONE `sample` transaction of the owning team: per line its batches oldest first and its racks
// holding the fewest first, one item per product equal to its batch rows, the batch value taken with the units. Too few
// in the warehouse refuses naming EVERY short line, and writes nothing; a rack a stock count holds is never taken from
// (a-lock-stops-sales-and-cancels-too). Batches are locked before racks, each in id order
// (batches-lock-before-shelves-by-id) — the transfer out-leg's order.
func PostParcelSample(tx *gorm.DB, s ParcelSample) (models.InventoryTransaction, []TakenLine, error) {
	return postSystemPickedTake(tx, inventory_ledgers.NewTransaction{
		WarehouseID: s.WarehouseID,
		TeamID:      s.TeamID,
		TxType:      models.TxSample,
		ActorID:     s.ActorID,
		IsOverride:  s.IsOverride,
		Description: s.Description,
		Recipient:   s.Recipient,
	}, s.Lines)
}

// postSystemPickedTake is THE take whose racks the system picks for one owning team — a transfer's out-leg and a parcel
// sample, the transaction's type and recipient being all that differs: the lines sorted by product, the team's batches
// locked and counted in one statement (a refusal names every short line and writes nothing), then the transaction and
// takeLines (batches oldest first, racks fewest first, one item per product).
func postSystemPickedTake(
	tx *gorm.DB,
	nt inventory_ledgers.NewTransaction,
	sent []TransferLine,
) (models.InventoryTransaction, []TakenLine, error) {
	lines := make([]OrderLine, 0, len(sent))
	for _, line := range sent {
		lines = append(lines, OrderLine{ProductID: line.ProductID, OwnerTeamID: nt.TeamID, Quantity: line.Quantity})
	}

	lines = sortedByProduct(lines)

	locked, err := inventory_ledgers.LockBatches(tx, nt.WarehouseID, ownersOf(lines))
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	err = refuseShortLines(locked, lines)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	t, err := inventory_ledgers.CreateTransaction(tx, nt)
	if err != nil {
		return t, nil, err
	}

	taken, err := takeLines(tx, t, locked, lines, nt.ActorID, nt.Description)
	if err != nil {
		return t, nil, err
	}

	return t, taken, nil
}
