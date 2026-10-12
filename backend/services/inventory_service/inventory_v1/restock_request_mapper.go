package inventory_v1

import (
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Restock status as stored in the `status` TEXT column. This mapper is the only reader/writer, so validity is guarded
// here (no DB CHECK IN-list, cf. #80).
//
// ⚠ THE STORED TEXT PREDATES THE REWRITE (the-restock-contract-changes-in-place): `pending` is what the contract now
// calls ONGOING and `fulfilled` is ACCEPTED. The text is left as it is — renaming it is a data migration, and that
// belongs to the backend step. `arrived` and `lost` are written by RestockRequestArrive / RestockRequestMarkLost,
// which land in that same step.
const (
	restockStatusOngoing   = "pending"
	restockStatusAccepted  = "fulfilled"
	restockStatusCancelled = "cancelled"
	restockStatusArrived   = "arrived"
	restockStatusLost      = "lost"
)

// restockInboundStatuses is "still coming": on its way, or at the door and not yet counted. What a warehouse waits
// for and what a selling team has committed and not received are both this set.
var restockInboundStatuses = []string{restockStatusOngoing, restockStatusArrived}

// How a restock raised before paying accounts was paid for, as stored in `payment_type` (#127). Read-only history now
// (a-restock-must-name-the-account-that-paid): new restocks name an account and write nothing here.
const (
	restockPaymentShopeePay   = "shopee_pay"
	restockPaymentBankAccount = "bank_account"
)

// What happened to a restock, as stored in `restock_request_events.kind` (00019). The contract now reads them as
// RestockLog rows (every-status-change-is-logged, edits-are-in-the-same-trail) — see restockLogFromEvent.
const (
	restockEventCreated   = "created"
	restockEventEdited    = "edited"
	restockEventAccepted  = "accepted"
	restockEventCancelled = "cancelled"
	restockEventCODFee    = "cod_fee"
	// 00021: what the delivery cost the WAREHOUSE — the courier's charge at the door.
	restockEventCostRecorded = "cost_recorded"
)

// What went wrong with units at the door, as stored in `restock_damaged_units.damage_type` (#154).
//
// ⚠ `lost` IS STORED TEXT FOR WHAT THE CONTRACT CALLS MISSING (a-short-unit-at-the-door-is-missing): it always meant
// "ordered, not in the box". Left as it is until the backend step renames the data.
const (
	restockProblemBroken  = "broken"
	restockProblemMissing = "lost"
)

// When the warehouse leaves the optional note empty (a-broken-reason-is-optional). ⚠ The column still carries
// `CHECK (reason <> ”)` from 00013; until the backend step drops it, an empty note is stored as these words.
const (
	restockProblemBrokenDefaultNote  = "broken at the door"
	restockProblemMissingDefaultNote = "missing from the box"
)

// The one kind a restock cost line is stored under (00021) — the courier's charge at the door. A restock carries at
// most one (the-courier-is-paid-once-per-restock).
const (
	restockCostIncidental = "incidental"
)

var (
	errRestockMissing = errors.New("restock request not found")
	// Edit and cancel are the selling team's while the restock is ongoing (a-restock-is-cancelled-only-while-ongoing,
	// a-restock-is-edited-only-while-ongoing).
	errRestockNotOngoing = errors.New("restock request is not ongoing")
	// Accept takes a restock from ongoing or arrived only (accept-locks-the-restock).
	errRestockNotAcceptable = errors.New("restock request can only be accepted while ongoing or arrived")
	// Labels exist only once the goods are stock.
	errRestockNotAccepted = errors.New("restock request is not accepted")
	// The supplier a line names must be a live one, of any selling team.
	errRestockSupplierMissing = errors.New("supplier not found")
	// Proto validation requires min_items 1, so this can only be a row written around the API.
	errRestockNoItems = errors.New("restock request has no items")
	// Accepting IS the count: every line named, once, and no line that is not on it.
	errRestockCountIncomplete = errors.New("every line of the request must be counted exactly once")
	// More in the box than the line says is the selling team's edit to make first (accept-refuses-more-than-the-line-says).
	errRestockOverCount = errors.New("more arrived than ordered — ask the selling team to add them")
	// Broken units are among those that arrived.
	errRestockBrokenOverReceived = errors.New("broken cannot be more than received")
	// Good units are somewhere (there-is-no-unplaced-pile): a line with good units names its placements.
	errRestockLineNoPlace = errors.New("a line with good units must say which placement they went to")
	// The placements must add up to the good units — received minus broken.
	errRestockPlacementMismatch = errors.New("the placements must add up to the good units")
	// A line names each placement once.
	errRestockPlacementDuplicate = errors.New("a line may name each placement only once")
	// The courier's charge says what it was for (an-incidental-line-must-say-what-it-was-for).
	errRestockCostNoteMissing = errors.New("the courier's charge needs a note")
)

func restockStatusToText(status inventoryv1.RestockRequestStatus) string {
	switch status {
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING:
		return restockStatusOngoing
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED:
		return restockStatusAccepted
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED:
		return restockStatusCancelled
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED:
		return restockStatusArrived
	case inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST:
		return restockStatusLost
	default:
		return ""
	}
}

func restockStatusFromText(text string) inventoryv1.RestockRequestStatus {
	switch text {
	case restockStatusOngoing:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING
	case restockStatusAccepted:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED
	case restockStatusCancelled:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED
	case restockStatusArrived:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED
	case restockStatusLost:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST
	default:
		return inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED
	}
}

func restockProblemTypeFromText(text string) inventoryv1.RestockProblemType {
	switch text {
	case restockProblemBroken:
		return inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_BROKEN
	case restockProblemMissing:
		return inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_MISSING
	default:
		return inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_UNSPECIFIED
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

// restockLogFromEvent reads a stored event as a trail row. The events table records WHAT happened, not the status on
// either side, so the two statuses are inferred from the kind — exact for every kind written today, because each one
// only ever happens from ongoing. The backend step replaces the table with `restock_logs`, which stores both.
func restockLogFromEvent(e *inventory_service_models.RestockRequestEvent) *inventoryv1.RestockLog {
	ongoing := inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING

	out := &inventoryv1.RestockLog{
		Id:          e.ID,
		FromStatus:  ongoing,
		ToStatus:    ongoing,
		ActorUserId: e.ActorUserID,
		AtUnix:      e.At.Unix(),
	}

	switch e.Kind {
	case restockEventCreated:
		out.FromStatus = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED
		out.Description = "created"
	case restockEventEdited:
		out.Description = "edited"
	case restockEventAccepted:
		out.ToStatus = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED
		out.Description = "accepted"
	case restockEventCancelled:
		out.ToStatus = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED
		out.Description = "cancelled"
	case restockEventCODFee, restockEventCostRecorded:
		out.Description = "courier's charge recorded"
	default:
		// A kind this build does not know still HAPPENED; the trail keeps it rather than shortening the history.
		out.Description = e.Kind
	}

	return out
}

// restockLineSupplier is the supplier every line names, or nil when they disagree or name none.
//
// ⚠ A BRIDGE until restock lines store their own supplier (the backend step): the restock-level column is what
// RestockAccepted's `supplier_id` — and so a supplier's figures — still read. A restock whose lines name one supplier
// keeps feeding them; one that mixes suppliers records none here, rather than crediting all of it to the first.
func restockLineSupplier(items []*inventoryv1.RestockRequestItem) *uint64 {
	var supplier uint64

	for _, item := range items {
		id := item.GetSupplierId()
		if id == 0 {
			return nil
		}

		if supplier != 0 && supplier != id {
			return nil
		}

		supplier = id
	}

	if supplier == 0 {
		return nil
	}

	return &supplier
}

// problemPrice is a problem row's worth, filled by the system from its line and never typed
// (the-problem-price-is-filled-by-the-system): the line's total × count ÷ the line's count.
func problemPrice(lineTotal, lineCount, count int64) (unit, total int64) {
	if lineCount <= 0 {
		return 0, 0
	}

	return lineTotal / lineCount, lineTotal * count / lineCount
}

func restockRequestToProto(r *inventory_service_models.RestockRequest) *inventoryv1.RestockRequest {
	items := make([]*inventoryv1.RestockRequestItem, 0, len(r.Items))

	var subtotal int64

	for i := range r.Items {
		src := &r.Items[i]

		item := &inventoryv1.RestockRequestItem{
			Id:        src.ID,
			ProductId: src.ProductID,
			Sku:       src.SKU,
			Name:      src.Name,
			Count:     src.Quantity,
			Total:     src.TotalPrice,
		}

		if src.Quantity > 0 {
			item.PriceUnit = src.TotalPrice / src.Quantity
		}

		// Until lines store their own supplier, every line reads the restock's.
		if r.SupplierID != nil {
			item.SupplierId = *r.SupplierID
		}

		subtotal += src.TotalPrice

		for p := range src.Placements {
			item.Placements = append(item.Placements, placementToProto(&src.Placements[p]))
		}

		// `received_quantity` stored the GOOD units; the contract's received_count is what was in the box, so the
		// broken rows are added back (any-warehouse-member-counts-what-arrived).
		received := src.ReceivedQuantity

		for d := range src.Damaged {
			problem := &src.Damaged[d]
			kind := restockProblemTypeFromText(problem.DamageType)

			if kind == inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_BROKEN {
				received += problem.Quantity
			}

			unit, total := problemPrice(src.TotalPrice, src.Quantity, problem.Quantity)

			item.Problems = append(item.Problems, &inventoryv1.RestockProblemItem{
				Type:      kind,
				Count:     problem.Quantity,
				PriceUnit: unit,
				Total:     total,
				Note:      problem.Reason,
			})
		}

		item.ReceivedCount = received

		items = append(items, item)
	}

	out := &inventoryv1.RestockRequest{
		Id:               r.ID,
		RequestingTeamId: r.RequestingTeamID,
		WarehouseId:      r.WarehouseID,
		Status:           restockStatusFromText(r.Status),
		CreatedAtUnix:    r.CreatedAt.Unix(),
		Items:            items,
		Receipt:          r.Receipt,
		InvoiceRefId:     r.OrderRef,
		PaymentType:      restockPaymentFromText(r.PaymentType),
		ShipmentCost:     r.ShippingCost,
		Subtotal:         subtotal,
		// Goods plus shipping — never the courier's charge (the-couriers-charge-stays-out-of-total).
		Total:            subtotal + r.ShippingCost,
		Note:             r.Note,
		CreatedByUserId:  r.CreatedByUserID,
		AcceptedByUserId: r.AcceptedByUserID,

		CancelledByUserId: r.CancelledByUserID,
	}

	// The courier's charge, one per restock with its note (the-courier-is-paid-once-per-restock). Rows from before the
	// decision may hold several lines; they read as their sum, their notes joined.
	var notes []string

	for i := range r.CostLines {
		out.WarehouseAdditionalCost += r.CostLines[i].Amount

		if r.CostLines[i].Note != "" {
			notes = append(notes, r.CostLines[i].Note)
		}
	}

	out.WarehouseAdditionalCostNote = strings.Join(notes, "; ")

	// THE TRAIL, oldest first — empty unless the caller preloaded it, which only Detail does.
	for i := range r.Events {
		out.Logs = append(out.Logs, restockLogFromEvent(&r.Events[i]))
	}

	// NULL means "it has not happened", which the wire says as 0, not as the zero time.Time.
	if r.AcceptedAt != nil {
		out.AcceptedAtUnix = r.AcceptedAt.Unix()
	}

	if r.CancelledAt != nil {
		out.CancelledAtUnix = r.CancelledAt.Unix()
	}

	return out
}

// restockItemModels turns request lines into rows. The fields a line READS BACK after accept — received_count,
// placements, problems — are deliberately NOT read: only the warehouse writes them, and only by counting at the door.
//
// ⚠ supplier_id, supplier_channel_id and note have no column until the backend step; supplier_id is carried at the
// restock level by restockLineSupplier.
func restockItemModels(in []*inventoryv1.RestockRequestItem) []inventory_service_models.RestockRequestItem {
	out := make([]inventory_service_models.RestockRequestItem, 0, len(in))
	for _, item := range in {
		out = append(out, inventory_service_models.RestockRequestItem{
			ProductID:  item.GetProductId(),
			SKU:        item.GetSku(),
			Name:       item.GetName(),
			Quantity:   item.GetCount(),
			TotalPrice: item.GetTotal(),
		})
	}

	return out
}

// restockErr maps the internal errors to Connect codes: a missing/cross-scope restock is NotFound; one in the wrong
// status is FailedPrecondition; a malformed count is InvalidArgument; everything else is Internal.
func restockErr(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errRestockMissing)
	case errors.Is(err, errRestockSupplierMissing):
		// NotFound, not PermissionDenied: another team's supplier must be indistinguishable from one that does not
		// exist, or the error itself confirms the id.
		return connect.NewError(connect.CodeNotFound, errRestockSupplierMissing)
	case errors.Is(err, errRestockNotOngoing),
		errors.Is(err, errRestockNotAcceptable),
		errors.Is(err, errRestockNotAccepted),
		errors.Is(err, errRestockNoItems):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errRestockCountIncomplete),
		errors.Is(err, errRestockOverCount),
		errors.Is(err, errRestockBrokenOverReceived),
		errors.Is(err, errRestockLineNoPlace),
		errors.Is(err, errRestockPlacementMismatch),
		errors.Is(err, errRestockPlacementDuplicate),
		errors.Is(err, errRestockCostNoteMissing):
		// InvalidArgument: the restock is in a good state — it is the COUNT that is malformed.
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errRackMissing):
		// NotFound: another warehouse's placement must be indistinguishable from one that does not exist.
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// placementToProto carries one placement over the wire. Every unit in stock is on a placement
// (there-is-no-unplaced-pile); a row from the unplaced pile that predates the decision reads as placement 0.
func placementToProto(p *inventory_service_models.RestockReceivedPlacement) *inventoryv1.RestockPlacement {
	out := &inventoryv1.RestockPlacement{Quantity: p.Quantity}

	if p.RackID != nil {
		out.PlacementId = *p.RackID
	}

	return out
}

// recordRestockEvent appends one entry to a restock's trail (00019), IN THE SAME TRANSACTION as the change it
// describes, carrying the same instant as the column the handler stamps.
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
