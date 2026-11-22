package inventory_v1

import (
	"time"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE SETTLEMENT IN THE RESTOCK'S RIWAYAT (backlog #101 — the owner's 🔄 on a-restock-problem-is-settled-by-resolution-rows
// and the-restock-resolutions-prototype-is-accepted): one REAL trail row per resolution recorded, per *Tandai Selesai*
// and per reopen, with who and when, written in the SAME transaction as what it records and never rewritten — so
// settled → reopened → settled reads all three. Each is a `restock_logs` row keeping the status (from = to, as an edit's
// does), told apart by its stored word; what it names rides `restock_log_changes` (00061 widened its field CHECK).
//
// The words as stored in `restock_logs.description` — this file is their only writer, restockLogKindFromText their
// only reader.
const (
	restockLogResolution = "resolution recorded"
	restockLogSettled    = "settled"
	restockLogReopened   = "reopened"
)

// The settlement's change fields, as stored in `restock_log_changes.field` (CHECKed there, 00061).
const (
	// A RESOLUTION row's: the resolution's id. The row itself (type, note, refund, parcel) is the detail's `resolutions`
	// — a warehouse reader is answered no refund money there, and the trail carries none either.
	restockChangeResolution = "resolution"
	// A REOPENED row's: the inbound parcel whose Terima reopened it.
	restockChangeParcel = "parcel"
	// A REOPENED row's, per product: the units the parcel came short, and the units broken in it.
	restockChangeParcelShort  = "parcel_short"
	restockChangeParcelBroken = "parcel_broken"
)

// recordResolutionLog writes a resolution's trail row, right after the row itself and under the restock's lock: its
// actor and instant are the resolution's own, its one change the resolution's id.
func recordResolutionLog(tx *gorm.DB, rr *models.Restock, row *models.RestockResolution) error {
	logRow, err := recordRestockLogRow(tx, rr.ID, rr.Status, rr.Status, row.CreatedByUserID, row.CreatedByIsOverride,
		restockLogResolution, row.CreatedAt)
	if err != nil {
		return err
	}

	return recordRestockLogChanges(tx, logRow.ID, []models.RestockLogChange{{
		Field:      restockChangeResolution,
		AfterValue: changeID(row.ID),
	}})
}

// recordSettledLog writes *Tandai Selesai*'s trail row — who marked it, when (the settled mark's own instant).
func recordSettledLog(tx *gorm.DB, rr *models.Restock, actor uint64, override bool, at time.Time) error {
	return recordRestockLog(tx, rr.ID, rr.Status, rr.Status, actor, override, restockLogSettled, at)
}

// recordReopenedLog writes a reopen's trail row: the warehouse member whose Terima counted the inbound parcel short or
// broken, the parcel, and per product what was short and what broken — from the parcel's lines as Terima just counted
// them (Received / Broken set).
func recordReopenedLog(
	tx *gorm.DB,
	rr *models.Restock,
	parcelID uint64,
	items []models.CustomShipmentItem,
	actor uint64,
	override bool,
	at time.Time,
) error {
	logRow, err := recordRestockLogRow(tx, rr.ID, rr.Status, rr.Status, actor, override, restockLogReopened, at)
	if err != nil {
		return err
	}

	changes := []models.RestockLogChange{{Field: restockChangeParcel, AfterValue: changeID(parcelID)}}

	for i := range items {
		item := &items[i]

		var received, broken int64
		if item.Received != nil {
			received = *item.Received
		}

		if item.Broken != nil {
			broken = *item.Broken
		}

		if short := item.Quantity - received; short > 0 {
			changes = append(changes, models.RestockLogChange{
				Field:       restockChangeParcelShort,
				ProductID:   item.ProductID,
				ProductName: item.Name,
				AfterValue:  changeCount(short),
			})
		}

		if broken > 0 {
			changes = append(changes, models.RestockLogChange{
				Field:       restockChangeParcelBroken,
				ProductID:   item.ProductID,
				ProductName: item.Name,
				AfterValue:  changeCount(broken),
			})
		}
	}

	return recordRestockLogChanges(tx, logRow.ID, changes)
}

// restockLogKindFromText is what a trail row records beyond a status change, the create or an edit — read from its
// stored word, and only on a row that kept its status (a status row's description is never read as a kind).
func restockLogKindFromText(l *models.RestockLog) inventoryv1.RestockLogKind {
	if l.FromStatus == "" || l.FromStatus != l.ToStatus {
		return inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_UNSPECIFIED
	}

	switch l.Description {
	case restockLogResolution:
		return inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_RESOLUTION
	case restockLogSettled:
		return inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_SETTLED
	case restockLogReopened:
		return inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_REOPENED
	default:
		return inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_UNSPECIFIED
	}
}
