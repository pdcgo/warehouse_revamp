package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestUpdate lets the RAISING team edit its own restock until the warehouse accepts it. Scoped to
// requesting_team_id: another team's restock reads as NotFound, exactly as for Cancel. It is a full REPLACE — the
// edit screen is the create form re-opened — and how much of it may change depends on where the box is:
//
//	ongoing  → every field (a-restock-is-edited-only-while-ongoing).
//	arrived  → the LINES only: count, total, note. Lines may be added, never removed
//	           (the-lines-stay-editable-until-accepted, lines-can-be-added-not-removed-while-arrived). A NEW line may
//	           name its supplier and store; a stored line keeps its own (a-line-added-after-arrival-names-its-supplier).
//	           Any other field that differs from what is stored is refused.
//	otherwise → FailedPrecondition.
//
// Every edit is a row of the trail, the status unchanged (edits-are-in-the-same-trail).
//
// The row is loaded FOR UPDATE and the status re-checked inside the transaction: the check and the write have to be
// atomic, or an edit racing the warehouse's accept could land just after the box was counted.
func (s *Service) RestockRequestUpdate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestUpdateRequest],
) (*connect.Response[inventoryv1.RestockRequestUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	msg := req.Msg

	err := productsOnce(msg.GetItems())
	if err != nil {
		return nil, restockErr(err)
	}

	// The suppliers are asked BEFORE the row is locked — a call to another service must never run while this restock
	// is held FOR UPDATE, or a warehouse accepting the delivery waits out a network round-trip
	// (audits/services/inventory_service/concurrency/RestockRequestUpdate.md). Whether an answer MATTERS — only a line
	// whose supplier changed is checked — can only be known under the lock, so it is judged there.
	answers := s.askLineSuppliers(ctx, teamID, msg.GetItems())
	stores := s.askLineStores(ctx, teamID, msg.GetItems())

	var (
		rr         inventory_service_models.RestockRequest
		oldAccount uint64
		oldAmount  int64
		editedAt   time.Time
		editLogID  uint64
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND requesting_team_id = ?", msg.GetRequestId(), teamID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		var stored []inventory_service_models.RestockRequestItem

		storedErr := tx.
			Where("restock_request_id = ?", rr.ID).
			Order("id").
			Find(&stored).
			Error
		if storedErr != nil {
			return storedErr
		}

		byProduct := make(map[uint64]*inventory_service_models.RestockRequestItem, len(stored))
		for i := range stored {
			byProduct[stored[i].ProductID] = &stored[i]
		}

		// Only a CHANGED supplier is validated. A full replace re-sends the supplier the form prefilled, so an
		// unchanged one is the line PRESERVING a reference it already holds. Re-checking it would make every restock
		// that names a since-deleted supplier un-editable, about a field nobody touched.
		for _, item := range msg.GetItems() {
			want := item.GetSupplierId()
			if want == 0 {
				continue
			}

			old, ok := byProduct[item.GetProductId()]
			if ok && idOrZero(old.SupplierID) == want {
				continue
			}

			answer := answers[want]
			if answer.err != nil {
				return answer.err
			}

			if !answer.live {
				return errRestockSupplierMissing
			}
		}

		// The same for a store: one the line already held is kept even if it was deleted since; a store newly named
		// must belong to the line's supplier and be live.
		for _, item := range msg.GetItems() {
			old, ok := byProduct[item.GetProductId()]
			if ok && idOrZero(old.SupplierChannelID) == item.GetSupplierChannelId() &&
				idOrZero(old.SupplierID) == item.GetSupplierId() {
				continue
			}

			storeErr := stores.check(item)
			if storeErr != nil {
				return storeErr
			}
		}

		// The money BEFORE the edit, for the difference it may make (an-edit-sends-the-difference). Read here, before
		// editArrived changes the stored lines in place.
		oldAccount = rr.FinanceAccountID
		oldAmount = rr.ShippingCost
		for i := range stored {
			oldAmount += stored[i].TotalPrice
		}

		editedAt = time.Now()

		var editErr error

		switch rr.Status {
		case restockStatusOngoing:
			editErr = s.editOngoing(tx, &rr, msg, editedAt)
		case restockStatusArrived:
			editErr = editArrived(tx, &rr, stored, byProduct, msg, editedAt)
		default:
			editErr = errRestockNotEditable
		}

		if editErr != nil {
			return editErr
		}

		row, logErr := recordRestockLogRow(tx, rr.ID, rr.Status, rr.Status, actorFrom(ctx), restockLogEdited, editedAt)
		if logErr != nil {
			return logErr
		}

		editLogID = row.ID

		// Asking a warehouse to stock a product is what makes it VISIBLE there (#142) — a product added by this edit
		// included. ON CONFLICT DO NOTHING, so the products already linked cost nothing.
		return linkWarehouseProducts(tx, rr.WarehouseID, rr.Items)
	})
	if err != nil {
		return nil, restockErr(err)
	}

	// AFTER the commit, and only when the edit moved money: the amount changed, or the paying account did
	// (an-edit-sends-the-difference, an-edit-may-move-the-payment-to-another-account). A note or a tracking number
	// changes nothing the account holds.
	if rr.FinanceAccountID != oldAccount || restockAmount(&rr) != oldAmount {
		s.publishRestockMoney(ctx, restockUpdatedEvent(&rr, editLogID, oldAccount, oldAmount, actorFrom(ctx), editedAt))
	}

	return connect.NewResponse(&inventoryv1.RestockRequestUpdateResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// editOngoing replaces every field and every line. While ongoing nothing references a line — stock moves only at
// accept — so the lines are rewritten rather than diffed.
func (s *Service) editOngoing(
	tx *gorm.DB,
	rr *inventory_service_models.RestockRequest,
	msg *inventoryv1.RestockRequestUpdateRequest,
	editedAt time.Time,
) error {
	// Required while ongoing (a-restock-names-its-paying-account); the field is not, so a restock raised before paying
	// accounts can still have its lines fixed once it has arrived.
	if msg.GetFinanceAccountId() == 0 {
		return errRestockAccountRequired
	}

	rr.WarehouseID = msg.GetWarehouseId()
	rr.Receipt = msg.GetReceipt()
	rr.ReceiptFile = msg.GetReceiptFile()
	rr.ShipmentID = msg.GetShipmentId()
	rr.OrderRef = msg.GetInvoiceRefId()
	rr.FinanceAccountID = msg.GetFinanceAccountId()
	rr.ShippingCost = msg.GetShipmentCost()
	rr.Note = msg.GetNote()

	// A map, not the struct: GORM skips a struct's zero values, which is precisely backwards here — clearing the note
	// or zeroing the freight IS the edit, and a struct update would silently keep the old value.
	updErr := tx.
		Model(rr).
		Updates(map[string]any{
			"warehouse_id":       rr.WarehouseID,
			"receipt":            rr.Receipt,
			"receipt_file":       rr.ReceiptFile,
			"shipment_id":        rr.ShipmentID,
			"order_ref":          rr.OrderRef,
			"finance_account_id": rr.FinanceAccountID,
			"shipping_cost":      rr.ShippingCost,
			"note":               rr.Note,
			"updated_at":         editedAt,
		}).
		Error
	if updErr != nil {
		return updErr
	}

	delErr := tx.
		Where("restock_request_id = ?", rr.ID).
		Delete(&inventory_service_models.RestockRequestItem{}).
		Error
	if delErr != nil {
		return delErr
	}

	items := restockItemModels(msg.GetItems())
	for i := range items {
		items[i].RestockRequestID = rr.ID
	}

	createErr := tx.Create(&items).Error
	if createErr != nil {
		return createErr
	}

	rr.Items = items

	return nil
}

// editArrived changes the lines and nothing else. A stored line keeps its id, its product and its supplier and store;
// its count, total and note follow the request. A line the request adds is inserted whole.
func editArrived(
	tx *gorm.DB,
	rr *inventory_service_models.RestockRequest,
	stored []inventory_service_models.RestockRequestItem,
	byProduct map[uint64]*inventory_service_models.RestockRequestItem,
	msg *inventoryv1.RestockRequestUpdateRequest,
	editedAt time.Time,
) error {
	if !restockFieldsUnchanged(rr, msg) {
		return errRestockArrivedLinesOnly
	}

	sent := make(map[uint64]struct{}, len(msg.GetItems()))
	for _, item := range msg.GetItems() {
		sent[item.GetProductId()] = struct{}{}
	}

	for i := range stored {
		if _, kept := sent[stored[i].ProductID]; !kept {
			return errRestockLineRemoved
		}
	}

	var added []inventory_service_models.RestockRequestItem

	for _, item := range msg.GetItems() {
		old, ok := byProduct[item.GetProductId()]
		if !ok {
			row := restockItemModels([]*inventoryv1.RestockRequestItem{item})[0]
			row.RestockRequestID = rr.ID
			added = append(added, row)

			continue
		}

		if idOrZero(old.SupplierID) != item.GetSupplierId() ||
			idOrZero(old.SupplierChannelID) != item.GetSupplierChannelId() {
			return errRestockArrivedSupplierLocked
		}

		old.Quantity = item.GetCount()
		old.TotalPrice = item.GetTotal()
		old.Note = item.GetNote()

		lineErr := tx.
			Model(old).
			Updates(map[string]any{
				"quantity":    old.Quantity,
				"total_price": old.TotalPrice,
				"note":        old.Note,
				"updated_at":  editedAt,
			}).
			Error
		if lineErr != nil {
			return lineErr
		}
	}

	if len(added) > 0 {
		addErr := tx.Create(&added).Error
		if addErr != nil {
			return addErr
		}
	}

	touchErr := tx.Model(rr).Update("updated_at", editedAt).Error
	if touchErr != nil {
		return touchErr
	}

	rr.Items = append(stored, added...)

	return nil
}

// restockFieldsUnchanged is true when everything but the lines is what is stored — the only edit an arrived restock
// takes.
func restockFieldsUnchanged(rr *inventory_service_models.RestockRequest, msg *inventoryv1.RestockRequestUpdateRequest) bool {
	return rr.WarehouseID == msg.GetWarehouseId() &&
		rr.Receipt == msg.GetReceipt() &&
		rr.ReceiptFile == msg.GetReceiptFile() &&
		rr.ShipmentID == msg.GetShipmentId() &&
		rr.OrderRef == msg.GetInvoiceRefId() &&
		rr.FinanceAccountID == msg.GetFinanceAccountId() &&
		rr.ShippingCost == msg.GetShipmentCost() &&
		rr.Note == msg.GetNote()
}

// supplierAnswer is supplier_service's answer about one supplier, taken before any lock.
type supplierAnswer struct {
	live bool
	err  error
}

// askLineSuppliers asks once per distinct supplier the lines name. A line naming none asks nothing.
func (s *Service) askLineSuppliers(
	ctx context.Context,
	teamID uint64,
	items []*inventoryv1.RestockRequestItem,
) map[uint64]supplierAnswer {
	answers := make(map[uint64]supplierAnswer, len(items))

	for _, item := range items {
		id := item.GetSupplierId()
		if id == 0 {
			continue
		}

		if _, done := answers[id]; done {
			continue
		}

		live, err := s.suppliers.SupplierIsLive(ctx, teamID, id)
		answers[id] = supplierAnswer{live: live, err: err}
	}

	return answers
}
