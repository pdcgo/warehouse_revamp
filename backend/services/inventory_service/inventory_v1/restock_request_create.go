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
// The optional supplier must belong to the REQUESTING team: suppliers are team-scoped, and letting a
// request point at another team's supplier would leak that team's vendor list by id.
func (s *Service) RestockRequestCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestCreateRequest],
) (*connect.Response[inventoryv1.RestockRequestCreateResponse], error) {
	teamID := req.Msg.GetTeamId()

	rr := inventory_service_models.RestockRequest{
		RequestingTeamID: teamID,
		WarehouseID:      req.Msg.GetWarehouseId(),
		ShippingCode:     req.Msg.GetShippingCode(),
		Status:           restockStatusPending,
		OrderRef:         req.Msg.GetOrderRef(),
		Receipt:          req.Msg.GetReceipt(),
		ShippingCost:     req.Msg.GetShippingCost(),
		PaymentType:      restockPaymentToText(req.Msg.GetPaymentType()),
		Note:             req.Msg.GetNote(),
		Items:            restockItemModels(req.Msg.GetItems()),
	}

	if supplierID := req.Msg.GetSupplierId(); supplierID != 0 {
		rr.SupplierID = &supplierID
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if rr.SupplierID != nil {
			exists, checkErr := supplierExists(tx, teamID, *rr.SupplierID)
			if checkErr != nil {
				return checkErr
			}

			if !exists {
				return errRestockSupplierMissing
			}
		}

		// GORM inserts the request and its lines in this transaction, stamping their
		// RestockRequestID — a request without its lines is not a request.
		return tx.Create(&rr).Error
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestCreateResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
