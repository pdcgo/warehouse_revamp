package inventory_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Restock request status as stored in the `status` TEXT column. This mapper is the only reader/writer,
// so validity is guarded here (no DB CHECK IN-list, cf. #80).
const (
	restockStatusPending   = "pending"
	restockStatusFulfilled = "fulfilled"
	restockStatusCancelled = "cancelled"
)

var (
	errRestockMissing    = errors.New("restock request not found")
	errRestockNotPending = errors.New("restock request is not pending")
)

func restockStatusFromText(text string) inventoryv1.RestockRequestStatus {
	switch text {
	case restockStatusPending:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_PENDING
	case restockStatusFulfilled:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_FULFILLED
	case restockStatusCancelled:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED
	default:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED
	}
}

func restockRequestToProto(r *inventory_service_models.RestockRequest) *inventoryv1.RestockRequest {
	return &inventoryv1.RestockRequest{
		Id:               r.ID,
		RequestingTeamId: r.RequestingTeamID,
		WarehouseId:      r.WarehouseID,
		ProductId:        r.ProductID,
		Sku:              r.SKU,
		Name:             r.Name,
		Quantity:         r.Quantity,
		ShippingCode:     r.ShippingCode,
		Status:           restockStatusFromText(r.Status),
		CreatedAtUnix:    r.CreatedAt.Unix(),
	}
}

// restockErr maps the internal errors to Connect codes: a missing/cross-scope request is NotFound; a
// request that is not pending is FailedPrecondition; everything else is Internal.
func restockErr(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errRestockMissing)
	case errors.Is(err, errRestockNotPending):
		return connect.NewError(connect.CodeFailedPrecondition, errRestockNotPending)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
