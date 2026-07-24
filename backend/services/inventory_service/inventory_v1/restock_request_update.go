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

// RestockRequestUpdate lets the REQUESTING team edit its own request for as long as the warehouse
// has not accepted it (#131) — nothing has physically happened yet, so there is nothing to protect.
// Scoped to requesting_team_id (another team's request reads as NotFound, exactly as for Cancel); a
// FULFILLED or CANCELLED request is refused with FailedPrecondition, because by then the goods have
// moved or the record is closed and an edit would rewrite history.
//
// The row is loaded FOR UPDATE and the status re-checked inside the transaction: the check and the
// write have to be atomic, or an edit racing the warehouse's fulfil could land just after the stock
// was received — changing the quantities the warehouse just accepted.
//
// It is a full REPLACE, lines included: the edit screen is the create form re-opened, so it submits
// the whole request back. The lines are rewritten rather than diffed — while a request is pending
// nothing references a line (stock only moves at fulfil), so their ids are not worth preserving.
func (s *Service) RestockRequestUpdate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestUpdateRequest],
) (*connect.Response[inventoryv1.RestockRequestUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	var rr inventory_service_models.RestockRequest

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND requesting_team_id = ?", req.Msg.GetRequestId(), teamID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusPending {
			return errRestockNotPending
		}

		items := restockItemModels(req.Msg.GetItems())
		if len(items) == 0 {
			// Proto validation (min_items 1) rejects this first; the guard is here so that a request
			// arriving around it fails as a precondition rather than as an opaque GORM error.
			return errRestockNoItems
		}

		var supplierID *uint64

		if id := req.Msg.GetSupplierId(); id != 0 {
			// Only a CHANGE is validated. A full replace re-sends the supplier the form prefilled, so an
			// unchanged id is the request PRESERVING a reference it already holds, not making a new one.
			// Re-checking it would punish the person for something they did not do: SupplierDelete is a
			// SOFT delete and supplierExists() requires `deleted = false`, so deleting a supplier would
			// otherwise make every pending request that names it permanently un-editable — failing with
			// "supplier not found in this team" about a field they never touched. Pointing a request at a
			// deleted supplier is still refused; keeping one that predates the deletion is not.
			unchanged := rr.SupplierID != nil && *rr.SupplierID == id

			if !unchanged {
				exists, checkErr := supplierExists(tx, teamID, id)
				if checkErr != nil {
					return checkErr
				}

				if !exists {
					return errRestockSupplierMissing
				}
			}

			supplierID = &id
		}

		rr.WarehouseID = req.Msg.GetWarehouseId()
		rr.ShippingCode = req.Msg.GetShippingCode()
		rr.Receipt = req.Msg.GetReceipt()
		rr.SupplierID = supplierID
		rr.OrderRef = req.Msg.GetOrderRef()
		rr.ShippingCost = req.Msg.GetShippingCost()
		rr.PaymentType = restockPaymentToText(req.Msg.GetPaymentType())
		rr.Note = req.Msg.GetNote()

		// A map, not the struct: GORM skips a struct's zero values, which is precisely backwards here
		// — clearing the note, dropping the supplier, or zeroing the freight IS the edit, and a
		// struct update would silently keep the old value instead.
		updErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"warehouse_id":  rr.WarehouseID,
				"shipping_code": rr.ShippingCode,
				"receipt":       rr.Receipt,
				"supplier_id":   rr.SupplierID,
				"order_ref":     rr.OrderRef,
				"shipping_cost": rr.ShippingCost,
				"payment_type":  rr.PaymentType,
				"note":          rr.Note,
				"updated_at":    time.Now(),
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

		for i := range items {
			items[i].RestockRequestID = rr.ID
		}

		createErr := tx.Create(&items).Error
		if createErr != nil {
			return createErr
		}

		rr.Items = items

		return nil
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestUpdateResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
