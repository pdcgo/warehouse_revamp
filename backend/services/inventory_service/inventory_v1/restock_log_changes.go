package inventory_v1

import (
	"strconv"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WHAT AN EDIT CHANGED (edits-are-in-the-same-trail): an edit's trail row keeps the status, and says what moved —
// *Kaos 10 → 12, extra stock* — as one `restock_log_changes` row per changed field (00049), before and after. The words
// as stored in `restock_log_changes.field` (CHECKed there); this file is their only writer and reader.
const (
	// The restock's own fields — an edit changes them only while ongoing (a-restock-is-edited-only-while-ongoing).
	restockChangeWarehouse      = "warehouse"
	restockChangeReceipt        = "receipt"
	restockChangeReceiptFile    = "receipt_file"
	restockChangeShipment       = "shipment"
	restockChangeInvoiceRef     = "invoice_ref"
	restockChangeFinanceAccount = "finance_account"
	restockChangeShipmentCost   = "shipment_cost"
	restockChangeNote           = "note"

	// The receiving warehouse's own note (the-warehouse-writes-its-own-note, 00053) — written by
	// RestockRequestWarehouseNoteSet alone, never by an edit (restockEditChanges never says it).
	restockChangeWarehouseNote = "warehouse_note"

	// A line's — named by its product (a-product-appears-once-per-restock).
	restockChangeLineAdded    = "line_added"
	restockChangeLineRemoved  = "line_removed"
	restockChangeLineCount    = "line_count"
	restockChangeLineTotal    = "line_total"
	restockChangeLineNote     = "line_note"
	restockChangeLineSupplier = "line_supplier"
	restockChangeLineStore    = "line_store"
)

// restockEditChanges is what the edit `msg` changes on the stored restock `rr` and its lines `stored` — read BEFORE the
// edit is applied (editArrived changes the stored lines in place). Every field whose value differs, once, in a fixed
// order: the restock's own fields, then the lines in the order the edit sends them, then the lines it removed.
//
//   - A value worked out from others is not a change of its own: a line's unit price follows its total and count, the
//     restock's subtotal and total follow its lines and shipping. Nor is a line's name or code — the product's
//     snapshot, not something the edit types.
//   - A line ADDED says its count, then its total, and — when given — its note, supplier and store, each with no
//     before (a-line-added-after-arrival-names-its-supplier: the trail names the added line and its supplier).
//   - A line REMOVED (ongoing only — lines-can-be-added-not-removed-while-arrived) says the count it had.
//   - Amounts compare as money does (san_money.Equal), never with ==.
//
// An edit that changes nothing returns none: its row is still written (every edit is a row of the trail), with no
// changes under it.
func restockEditChanges(
	rr *inventory_service_models.Restock,
	stored []inventory_service_models.RestockItem,
	msg *inventoryv1.RestockRequestUpdateRequest,
) []inventory_service_models.RestockLogChange {
	var out []inventory_service_models.RestockLogChange

	change := func(field string, productID uint64, name, before, after string) {
		if before == after {
			return
		}

		out = append(out, inventory_service_models.RestockLogChange{
			Field:       field,
			ProductID:   productID,
			ProductName: name,
			BeforeValue: before,
			AfterValue:  after,
		})
	}

	amount := func(field string, productID uint64, name string, before, after float64) {
		if san_money.Equal(before, after) {
			return
		}

		change(field, productID, name, changeAmount(before), changeAmount(after))
	}

	// The restock's own fields.
	change(restockChangeWarehouse, 0, "", changeID(rr.WarehouseID), changeID(msg.GetWarehouseId()))
	change(restockChangeReceipt, 0, "", rr.Receipt, msg.GetReceipt())
	change(restockChangeReceiptFile, 0, "", rr.ReceiptFile, msg.GetReceiptFile())
	change(restockChangeShipment, 0, "", changeID(rr.ShipmentID), changeID(msg.GetShipmentId()))
	change(restockChangeInvoiceRef, 0, "", rr.InvoiceRefID, msg.GetInvoiceRefId())
	change(restockChangeFinanceAccount, 0, "", changeID(rr.FinanceAccountID), changeID(msg.GetFinanceAccountId()))
	amount(restockChangeShipmentCost, 0, "", rr.ShipmentCost, msg.GetShipmentCost())
	change(restockChangeNote, 0, "", rr.Note, msg.GetNote())

	byProduct := make(map[uint64]*inventory_service_models.RestockItem, len(stored))
	for i := range stored {
		byProduct[stored[i].ProductID] = &stored[i]
	}

	sent := make(map[uint64]struct{}, len(msg.GetItems()))

	// The lines, in the order the edit sends them.
	for _, item := range msg.GetItems() {
		id := item.GetProductId()
		name := item.GetName()
		sent[id] = struct{}{}

		old, ok := byProduct[id]
		if !ok {
			change(restockChangeLineAdded, id, name, "", changeCount(item.GetCount()))
			// Its total is always said — 0 is a real total (a sample) — the rest only when given.
			out = append(out, inventory_service_models.RestockLogChange{
				Field:       restockChangeLineTotal,
				ProductID:   id,
				ProductName: name,
				AfterValue:  changeAmount(item.GetTotal()),
			})
			change(restockChangeLineNote, id, name, "", item.GetNote())
			change(restockChangeLineSupplier, id, name, "", changeID(item.GetSupplierId()))
			change(restockChangeLineStore, id, name, "", changeID(item.GetSupplierChannelId()))

			continue
		}

		change(restockChangeLineCount, id, name, changeCount(old.Count), changeCount(item.GetCount()))
		amount(restockChangeLineTotal, id, name, old.Total, item.GetTotal())
		change(restockChangeLineNote, id, name, old.Note, item.GetNote())
		change(restockChangeLineSupplier, id, name, changeID(idOrZero(old.SupplierID)), changeID(item.GetSupplierId()))
		change(restockChangeLineStore, id, name, changeID(idOrZero(old.SupplierChannelID)), changeID(item.GetSupplierChannelId()))
	}

	// Then the lines the edit left out, in the order they were stored.
	for i := range stored {
		if _, kept := sent[stored[i].ProductID]; kept {
			continue
		}

		change(restockChangeLineRemoved, stored[i].ProductID, stored[i].Name, changeCount(stored[i].Count), "")
	}

	return out
}

// recordRestockLogChanges writes an edit's changes under its trail row, in the edit's transaction and in the order
// restockEditChanges gave them (their ids keep it). None is nothing to write.
func recordRestockLogChanges(tx *gorm.DB, logID uint64, changes []inventory_service_models.RestockLogChange) error {
	if len(changes) == 0 {
		return nil
	}

	for i := range changes {
		changes[i].RestockLogID = logID
	}

	return tx.Create(&changes).Error
}

// restockLogChangeToProto carries one change over the wire, its field read back from the stored word.
func restockLogChangeToProto(c *inventory_service_models.RestockLogChange) *inventoryv1.RestockLogChange {
	return &inventoryv1.RestockLogChange{
		Field:       restockLogChangeFieldFromText(c.Field),
		ProductId:   c.ProductID,
		ProductName: c.ProductName,
		Before:      c.BeforeValue,
		After:       c.AfterValue,
	}
}

func restockLogChangeFieldFromText(field string) inventoryv1.RestockLogChangeField {
	switch field {
	case restockChangeWarehouse:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_WAREHOUSE
	case restockChangeReceipt:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_RECEIPT
	case restockChangeReceiptFile:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_RECEIPT_FILE
	case restockChangeShipment:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_SHIPMENT
	case restockChangeInvoiceRef:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_INVOICE_REF
	case restockChangeFinanceAccount:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_FINANCE_ACCOUNT
	case restockChangeShipmentCost:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_SHIPMENT_COST
	case restockChangeNote:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_NOTE
	case restockChangeWarehouseNote:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_WAREHOUSE_NOTE
	case restockChangeLineAdded:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_ADDED
	case restockChangeLineRemoved:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_REMOVED
	case restockChangeLineCount:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_COUNT
	case restockChangeLineTotal:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_TOTAL
	case restockChangeLineNote:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_NOTE
	case restockChangeLineSupplier:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_SUPPLIER
	case restockChangeLineStore:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_STORE
	default:
		return inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_UNSPECIFIED
	}
}

// changeID is an id as a change stores it: decimal, and "" for none (0).
func changeID(id uint64) string {
	if id == 0 {
		return ""
	}

	return strconv.FormatUint(id, 10)
}

// changeCount is a count as a change stores it.
func changeCount(n int64) string {
	return strconv.FormatInt(n, 10)
}

// changeAmount is an amount as a change stores it: the shortest decimal that reads back as the same number.
func changeAmount(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}
