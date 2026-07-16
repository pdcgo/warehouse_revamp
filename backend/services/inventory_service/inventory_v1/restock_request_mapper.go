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
	// The optional supplier must be one of the REQUESTING team's own (#124).
	errRestockSupplierMissing = errors.New("supplier not found in this team")
	// Proto validation requires min_items 1, so this can only be a row that predates #124 or was
	// written around the API — fulfilling it would receive nothing while claiming success.
	errRestockNoItems = errors.New("restock request has no items")
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
	items := make([]*inventoryv1.RestockRequestItem, 0, len(r.Items))
	for i := range r.Items {
		items = append(items, &inventoryv1.RestockRequestItem{
			Id:        r.Items[i].ID,
			ProductId: r.Items[i].ProductID,
			Sku:       r.Items[i].SKU,
			Name:      r.Items[i].Name,
			Quantity:  r.Items[i].Quantity,
			Price:     r.Items[i].Price,
		})
	}

	out := &inventoryv1.RestockRequest{
		Id:               r.ID,
		RequestingTeamId: r.RequestingTeamID,
		WarehouseId:      r.WarehouseID,
		ShippingCode:     r.ShippingCode,
		Status:           restockStatusFromText(r.Status),
		CreatedAtUnix:    r.CreatedAt.Unix(),
		Items:            items,
		OrderId:          r.OrderID,
		Receipt:          r.Receipt,
	}

	// A nil supplier is "none recorded" — the wire carries 0 rather than a null.
	if r.SupplierID != nil {
		out.SupplierId = *r.SupplierID
	}

	return out
}

// restockItemModels turns request lines into rows; `id` on the input is ignored (a caller does not
// get to choose a row's identity).
func restockItemModels(in []*inventoryv1.RestockRequestItem) []inventory_service_models.RestockRequestItem {
	out := make([]inventory_service_models.RestockRequestItem, 0, len(in))
	for _, item := range in {
		out = append(out, inventory_service_models.RestockRequestItem{
			ProductID: item.GetProductId(),
			SKU:       item.GetSku(),
			Name:      item.GetName(),
			Quantity:  item.GetQuantity(),
			Price:     item.GetPrice(),
		})
	}

	return out
}

// restockErr maps the internal errors to Connect codes: a missing/cross-scope request is NotFound; a
// request that is not pending is FailedPrecondition; everything else is Internal.
func restockErr(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errRestockMissing)
	case errors.Is(err, errRestockSupplierMissing):
		// NotFound, not PermissionDenied: another team's supplier must be indistinguishable from one
		// that does not exist, or the error itself confirms the id.
		return connect.NewError(connect.CodeNotFound, errRestockSupplierMissing)
	case errors.Is(err, errRestockNotPending):
		return connect.NewError(connect.CodeFailedPrecondition, errRestockNotPending)
	case errors.Is(err, errRestockNoItems):
		return connect.NewError(connect.CodeFailedPrecondition, errRestockNoItems)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
