package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestCreate records a selling team's restock request (status PENDING) with its priced
// lines (#105/#124). It does NOT touch stock — the target warehouse does that when it fulfils.
//
// The optional supplier must be a LIVE supplier — any selling team's, since team B restocks from team A's
// supplier on its own restock (a-team-restocks-from-another-teams-supplier). It is asked of supplier_service,
// which owns suppliers (the-supplier-gets-its-own-service); a deleted or unknown one is NotFound.
func (s *Service) RestockRequestCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestCreateRequest],
) (*connect.Response[inventoryv1.RestockRequestCreateResponse], error) {
	teamID := req.Msg.GetTeamId()

	rr := inventory_service_models.RestockRequest{
		RequestingTeamID: teamID,
		WarehouseID:      req.Msg.GetWarehouseId(),
		Status:           restockStatusOngoing,
		OrderRef:         req.Msg.GetInvoiceRefId(),
		Receipt:          req.Msg.GetReceipt(),
		ShippingCost:     req.Msg.GetShipmentCost(),
		Note:             req.Msg.GetNote(),
		Items:            restockItemModels(req.Msg.GetItems()),
		// WHO RAISED IT, from the caller's identity rather than the request body — a client that
		// could nominate its own author could file somebody else's name against a delivery.
		CreatedByUserID: actorFrom(ctx),
	}

	// The supplier the lines name, carried at the restock level until lines store their own (restockLineSupplier).
	// ⚠ finance_account_id, shipment_id, receipt_file and the line notes have no column until the backend step.
	if supplier := restockLineSupplier(req.Msg.GetItems()); supplier != nil {
		supplierID := *supplier
		rr.SupplierID = &supplierID

		// Asked BEFORE the transaction, never inside one: a call to another service would hold a pooled
		// connection — and any lock already taken — for a network round-trip
		// (audits/services/inventory_service/concurrency/lock-order.md). A supplier deleted between this
		// answer and the commit leaves the same state as "restock first, then delete", which is kept on purpose.
		live, checkErr := s.suppliers.SupplierIsLive(ctx, teamID, supplierID)
		if checkErr == nil && !live {
			checkErr = errRestockSupplierMissing
		}

		if checkErr != nil {
			return nil, restockErr(checkErr)
		}
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// GORM inserts the request and its lines in this transaction, stamping their
		// RestockRequestID — a request without its lines is not a request.
		createErr := tx.Create(&rr).Error
		if createErr != nil {
			return createErr
		}

		// THE FIRST ENTRY IN ITS HISTORY (00019). `rr.CreatedAt` rather than a fresh time.Now(): the
		// event must carry the same instant the row does, or the timeline and the created-date filter
		// disagree about which second the restock was raised.
		eventErr := recordRestockEvent(tx, rr.ID, restockEventCreated, rr.CreatedByUserID, rr.CreatedAt)
		if eventErr != nil {
			return eventErr
		}

		// Asking a warehouse to stock a product is what makes that product VISIBLE to it (#142). In the
		// same transaction, because a request whose products the warehouse cannot see is a request
		// nobody there can act on — the two facts have to land together or not at all.
		return linkWarehouseProducts(tx, rr.WarehouseID, rr.Items)
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestCreateResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
