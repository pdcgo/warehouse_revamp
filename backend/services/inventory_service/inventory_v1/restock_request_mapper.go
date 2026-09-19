package inventory_v1

import (
	"errors"
	"time"

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

// What happened to a restock, as stored in `restock_request_events.kind` (00019). Text, not a DB
// CHECK IN-list (cf. #80) — adding a kind is a constant here, never a migration.
const (
	restockEventCreated   = "created"
	restockEventEdited    = "edited"
	restockEventAccepted  = "accepted"
	restockEventCancelled = "cancelled"
	restockEventCODFee    = "cod_fee"
	// 00021: what the delivery cost the WAREHOUSE, superseding cod_fee now that a delivery can cost it
	// more than the fee at the door.
	restockEventCostRecorded = "cost_recorded"
)

// Unknown text reads back as UNSPECIFIED rather than being dropped: an event this build does not know
// still HAPPENED, and a timeline that silently omits it would be a shorter history than the truth.
func restockEventKindFromText(text string) inventoryv1.RestockRequestEventKind {
	switch text {
	case restockEventCreated:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_CREATED
	case restockEventEdited:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_EDITED
	case restockEventAccepted:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_ACCEPTED
	case restockEventCancelled:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_CANCELLED
	case restockEventCODFee:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_COD_FEE
	case restockEventCostRecorded:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_COST_RECORDED
	default:
		return inventoryv1.RestockRequestEventKind_RESTOCK_REQUEST_EVENT_KIND_UNSPECIFIED
	}
}

// How a unit failed to become stock, as stored in `restock_damaged_units.damage_type` (#154). Mapped
// here, not by a DB CHECK (cf. #80). Empty text (pre-2026-07-23 rows) reads back as UNSPECIFIED.
const (
	restockDamageBroken = "broken"
	restockDamageLost   = "lost"
)

// What kind of outlay a cost line is, as stored in `restock_cost_lines.kind` (00021). Mapped here,
// not by a DB CHECK IN-list (cf. #80).
//
// ⚠ THERE IS EXACTLY ONE. It held `cod_shipping` and `other`, which described the same money
// (the-ledger-speaks-the-business-words): what the warehouse had to pay to get one delivery in. That
// money is INCIDENTAL by nature, so no list of kinds can enumerate it — the NOTE says what a line
// was, and it is now required for exactly that reason.
const (
	restockCostIncidental = "incidental"
)

func restockCostKindToText(k inventoryv1.RestockCostKind) string {
	switch k {
	case inventoryv1.RestockCostKind_RESTOCK_COST_KIND_INCIDENTAL:
		return restockCostIncidental
	default:
		return ""
	}
}

// restockCostLinesToProto carries a delivery's outlay to the wire, in the order it was typed.
//
// An unloaded association is an empty slice, which is the correct wire value for a list response:
// "this response does not carry the lines", not "this delivery cost the warehouse nothing". Only the
// reads that preload them say anything about them.
func restockCostLinesToProto(lines []inventory_service_models.RestockCostLine) []*inventoryv1.RestockCostLine {
	if len(lines) == 0 {
		return nil
	}

	out := make([]*inventoryv1.RestockCostLine, 0, len(lines))
	for i := range lines {
		out = append(out, &inventoryv1.RestockCostLine{
			Id:     lines[i].ID,
			Kind:   restockCostKindFromText(lines[i].Kind),
			Amount: lines[i].Amount,
			Note:   lines[i].Note,
		})
	}

	return out
}

func restockCostKindFromText(text string) inventoryv1.RestockCostKind {
	switch text {
	case restockCostIncidental:
		return inventoryv1.RestockCostKind_RESTOCK_COST_KIND_INCIDENTAL
	default:
		return inventoryv1.RestockCostKind_RESTOCK_COST_KIND_UNSPECIFIED
	}
}

func restockDamageTypeToText(t inventoryv1.RestockDamageType) string {
	switch t {
	case inventoryv1.RestockDamageType_RESTOCK_DAMAGE_TYPE_BROKEN:
		return restockDamageBroken
	case inventoryv1.RestockDamageType_RESTOCK_DAMAGE_TYPE_LOST:
		return restockDamageLost
	default:
		return ""
	}
}

func restockDamageTypeFromText(text string) inventoryv1.RestockDamageType {
	switch text {
	case restockDamageBroken:
		return inventoryv1.RestockDamageType_RESTOCK_DAMAGE_TYPE_BROKEN
	case restockDamageLost:
		return inventoryv1.RestockDamageType_RESTOCK_DAMAGE_TYPE_LOST
	default:
		return inventoryv1.RestockDamageType_RESTOCK_DAMAGE_TYPE_UNSPECIFIED
	}
}

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
	// Labels exist only once the goods have arrived (#207): a pending request has no placements to
	// print, and a cancelled one never will. Refused as FailedPrecondition, not guessed.
	errRestockNotFulfilled = errors.New("restock request is not fulfilled")
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
	// 00021: a cost line whose kind this build does not know. Refused rather than stored as text the
	// mapper cannot read back — an unrecognised kind would still be charged to the requesting team
	// while showing as "unspecified" on the screen that has to justify it.
	errCostLineKind = errors.New("a cost line must name a known kind")
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
				Type:     restockDamageTypeFromText(r.Items[i].Damaged[d].DamageType),
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
		CostLines:        restockCostLinesToProto(r.CostLines),
		PaymentType:      restockPaymentFromText(r.PaymentType),
		Note:             r.Note,
		CreatedByUserId:  r.CreatedByUserID,
		AcceptedByUserId: r.AcceptedByUserID,

		CancelledByUserId: r.CancelledByUserID,
	}

	// THE HISTORY, oldest first — empty unless the caller preloaded it, which only Detail does. An
	// unloaded association is an empty slice here, and that is the correct wire value for the list:
	// "this response does not carry the history", not "this restock has none".
	for i := range r.Events {
		out.Events = append(out.Events, &inventoryv1.RestockRequestEvent{
			Id:          r.Events[i].ID,
			Kind:        restockEventKindFromText(r.Events[i].Kind),
			ActorUserId: r.Events[i].ActorUserID,
			AtUnix:      r.Events[i].At.Unix(),
		})
	}

	// A nil supplier is "none recorded" — the wire carries 0 rather than a null.
	if r.SupplierID != nil {
		out.SupplierId = *r.SupplierID
	}

	// Same shape for the two nullable timestamps: NULL means "it has not happened", and the wire says
	// that as 0 rather than as the zero time.Time, which would ride over as a date in year 1.
	if r.AcceptedAt != nil {
		out.AcceptedAtUnix = r.AcceptedAt.Unix()
	}

	if r.CancelledAt != nil {
		out.CancelledAtUnix = r.CancelledAt.Unix()
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
	case errors.Is(err, errRestockNotFulfilled):
		return connect.NewError(connect.CodeFailedPrecondition, errRestockNotFulfilled)
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

// recordRestockEvent appends one entry to a restock's history (00019).
//
// IN THE SAME TRANSACTION as the change it describes, always — that is the only reason it takes a
// `tx` rather than the service's db. An event written outside the transaction can survive a rolled
// back write, and a history claiming something that never happened is worse than no history.
//
// `at` is passed in rather than taken here so the event carries the SAME instant as the column the
// handler stamps — two calls to time.Now() a microsecond apart would have the timeline and the
// `accepted_at` filter disagreeing about which second a delivery landed.
func recordRestockEvent(
	tx *gorm.DB,
	requestID uint64,
	kind string,
	actor uint64,
	at time.Time,
) error {
	return tx.Create(&inventory_service_models.RestockRequestEvent{
		RestockRequestID: requestID,
		Kind:             kind,
		ActorUserID:      actor,
		At:               at,
	}).Error
}
