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

// How the restock was paid for, as stored in the `payment_type` TEXT column (#127). Mapped here, not
// by a DB CHECK IN-list (cf. #80). Empty text = none recorded.
const (
	restockPaymentShopeePay   = "shopee_pay"
	restockPaymentBankAccount = "bank_account"
)

func restockPaymentToText(p inventoryv1.RestockPaymentType) string {
	switch p {
	case inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY:
		return restockPaymentShopeePay
	case inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_BANK_ACCOUNT:
		return restockPaymentBankAccount
	default:
		return ""
	}
}

func restockPaymentFromText(text string) inventoryv1.RestockPaymentType {
	switch text {
	case restockPaymentShopeePay:
		return inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_SHOPEE_PAY
	case restockPaymentBankAccount:
		return inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_BANK_ACCOUNT
	default:
		return inventoryv1.RestockPaymentType_RESTOCK_PAYMENT_TYPE_UNSPECIFIED
	}
}

var (
	errRestockMissing    = errors.New("restock request not found")
	errRestockNotPending = errors.New("restock request is not pending")
	// The optional supplier must be one of the REQUESTING team's own (#124).
	errRestockSupplierMissing = errors.New("supplier not found in this team")
	// Proto validation requires min_items 1, so this can only be a row that predates #124 or was
	// written around the API — fulfilling it would receive nothing while claiming success.
	errRestockNoItems = errors.New("restock request has no items")
	// Accepting IS the count (#133), so the count must cover the request exactly: every line named,
	// once, and no line that is not on it. Refused rather than interpreted — reading an omitted line
	// as "all of it came" or "none of it did" is a guess, and a guess here is stock drift.
	errRestockCountIncomplete = errors.New("every line of the request must be counted exactly once")
	// #137: counting and shelving are one act, so a line that ARRIVED must say where it went. Goods
	// that turned up are somewhere; the system is told, or it refuses — it does not guess a shelf.
	errRestockLineNoPlace = errors.New("a line that arrived must say which place it was put")
	// #154: the places a line names must add up to the count beside them. A person who says "8 arrived"
	// and then puts 7 away has made a mistake in one of the two, and which one is not knowable here.
	errRestockPlacementMismatch = errors.New("the placements must add up to the received quantity")
	// #154: a line names each place once. Two rows for the same shelf is one placement written twice,
	// and summing them is not the same as the person having meant it.
	errRestockPlacementDuplicate = errors.New("a line may name each place only once")
)

// restockStatusToText is the direction the LIST FILTER needs (#130): an enum in, the stored text out.
// Empty for UNSPECIFIED, which the filter reads as "no filter" rather than as a status to match.
func restockStatusToText(status inventoryv1.RestockRequestStatus) string {
	switch status {
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_PENDING:
		return restockStatusPending
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_FULFILLED:
		return restockStatusFulfilled
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED:
		return restockStatusCancelled
	default:
		return ""
	}
}

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
		item := &inventoryv1.RestockRequestItem{
			Id:               r.Items[i].ID,
			ProductId:        r.Items[i].ProductID,
			Sku:              r.Items[i].SKU,
			Name:             r.Items[i].Name,
			Quantity:         r.Items[i].Quantity,
			TotalPrice:       r.Items[i].TotalPrice,
			ReceivedQuantity: r.Items[i].ReceivedQuantity,
		}

		// Where it was shelved, one entry per place (#137/#154), and what arrived broken.
		for p := range r.Items[i].Placements {
			item.Placements = append(item.Placements, placementToProto(&r.Items[i].Placements[p]))
		}

		for d := range r.Items[i].Damaged {
			item.Damaged = append(item.Damaged, &inventoryv1.RestockDamagedUnits{
				Quantity: r.Items[i].Damaged[d].Quantity,
				Reason:   r.Items[i].Damaged[d].Reason,
				Value:    r.Items[i].Damaged[d].Value,
			})
		}

		items = append(items, item)
	}

	out := &inventoryv1.RestockRequest{
		Id:               r.ID,
		RequestingTeamId: r.RequestingTeamID,
		WarehouseId:      r.WarehouseID,
		ShippingCode:     r.ShippingCode,
		Status:           restockStatusFromText(r.Status),
		CreatedAtUnix:    r.CreatedAt.Unix(),
		Items:            items,
		OrderRef:         r.OrderRef,
		Receipt:          r.Receipt,
		ShippingCost:     r.ShippingCost,
		CodShippingFee:   r.CODShippingFee,
		PaymentType:      restockPaymentFromText(r.PaymentType),
		Note:             r.Note,
	}

	// A nil supplier is "none recorded" — the wire carries 0 rather than a null.
	if r.SupplierID != nil {
		out.SupplierId = *r.SupplierID
	}

	return out
}

// restockItemModels turns request lines into rows. Three fields on the input message are deliberately
// NOT read, and every omission is load-bearing:
//
//   - `id` — a caller does not get to choose a row's identity.
//   - `received_quantity` — it is on the shared line message because a line READS back what arrived,
//     but only the WAREHOUSE may ever write it, and only by counting at acceptance (#133). Copying it
//     here would let the requesting team declare its own delivery received on create or edit: stock
//     the warehouse never saw, written by the party that benefits from claiming it arrived.
//   - `placements` / `damaged` — the same rule for the same reason (#137/#154): only the warehouse
//     says where the goods went and what arrived broken, and only by counting and shelving as it
//     accepts. A requesting team that could set these would be declaring which shelf a delivery it
//     never made had been placed on, or writing off goods it never handled.
//
// All of them are ignored on the way in. Do not "complete" this mapping by adding any of them.
func restockItemModels(in []*inventoryv1.RestockRequestItem) []inventory_service_models.RestockRequestItem {
	out := make([]inventory_service_models.RestockRequestItem, 0, len(in))
	for _, item := range in {
		out = append(out, inventory_service_models.RestockRequestItem{
			ProductID:  item.GetProductId(),
			SKU:        item.GetSku(),
			Name:       item.GetName(),
			Quantity:   item.GetQuantity(),
			TotalPrice: item.GetTotalPrice(),
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
	case errors.Is(err, errRestockCountIncomplete):
		// InvalidArgument, not FailedPrecondition: the request is in a perfectly good state — it is the
		// COUNT that is malformed, and the caller fixes it by sending a complete one.
		return connect.NewError(connect.CodeInvalidArgument, errRestockCountIncomplete)
	case errors.Is(err, errRestockLineNoPlace):
		return connect.NewError(connect.CodeInvalidArgument, errRestockLineNoPlace)
	case errors.Is(err, errRestockPlacementMismatch):
		return connect.NewError(connect.CodeInvalidArgument, errRestockPlacementMismatch)
	case errors.Is(err, errRestockPlacementDuplicate):
		return connect.NewError(connect.CodeInvalidArgument, errRestockPlacementDuplicate)
	case errors.Is(err, errRackMissing):
		// NotFound, not PermissionDenied: another warehouse's rack must be indistinguishable from one
		// that does not exist, or the error itself confirms the id.
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// placementToProto carries one placement over the wire (#154).
//
// The oneof is what makes "unplaced" say itself out loud. A nil rack becomes `unplaced: true` rather
// than `rack_id: 0`, because 0 is what an unset number looks like and the pile is a real place — the
// same distinction RackSelect keeps on screen (#136/#139) and the one #139 was written to defend.
func placementToProto(p *inventory_service_models.RestockReceivedPlacement) *inventoryv1.RestockPlacement {
	out := &inventoryv1.RestockPlacement{Quantity: p.Quantity}

	if p.RackID != nil {
		out.Place = &inventoryv1.RestockPlacement_RackId{RackId: *p.RackID}
	} else {
		out.Place = &inventoryv1.RestockPlacement_Unplaced{Unplaced: true}
	}

	return out
}
