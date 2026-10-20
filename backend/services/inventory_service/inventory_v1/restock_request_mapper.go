package inventory_v1

import (
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Restock status as stored in the `status` TEXT column. This mapper is the only reader/writer, so validity is guarded
// here (no DB CHECK IN-list, cf. #80).
//
// The words are the contract's since 00024 rewrote `pending` and `fulfilled`.
const (
	restockStatusOngoing   = "ongoing"
	restockStatusAccepted  = "accepted"
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

// What a trail row says beside its statuses (edits-are-in-the-same-trail). A status change says what moved it; an
// edit keeps the status and says it was an edit.
const (
	restockLogCreated   = "created"
	restockLogEdited    = "edited"
	restockLogArrived   = "signed for the box"
	restockLogAccepted  = "accepted"
	restockLogLost      = "given up as lost"
	restockLogCancelled = "cancelled"
)

// What went wrong with units at the door, as stored in `restock_problem_items.problem_type` (00030, CHECKed there). A
// unit short in the box is MISSING (a-short-unit-at-the-door-is-missing).
const (
	restockProblemBroken  = "broken"
	restockProblemMissing = "missing"
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
	// The store a line names must exist and be live when it is newly named (a-line-may-name-a-supplier-without-a-channel).
	errRestockStoreMissing = errors.New("store not found")
	// A store is always a supplier's store: a line naming one names its supplier too.
	errRestockStoreWithoutSupplier = errors.New("a line naming a store must name its supplier")
	// A store, when given, belongs to the supplier given (a-line-may-name-a-supplier-without-a-channel).
	errRestockStoreNotTheSuppliers = errors.New("the store does not belong to the line's supplier")
	// One restock lists each product once (a-product-appears-once-per-restock).
	errRestockProductTwice = errors.New("a restock lists each product once")
	// A restock carries only the team's own products (a-restock-carries-only-the-teams-own-products).
	errRestockProductNotOwned = errors.New("a restock carries only the team's own products")
	// The warehouse signs for a box on its way, or one given up that turned up after all
	// (a-late-lost-box-is-signed-for-as-arrived).
	errRestockNotArrivable = errors.New("only a restock on its way, or given up as lost, can be signed for")
	// The selling team edits while the box is on its way or at the door, never after (the-lines-stay-editable-until-accepted).
	errRestockNotEditable = errors.New("a restock is edited only while ongoing or arrived")
	// Every restock names the account that paid (a-restock-names-its-paying-account).
	errRestockAccountRequired = errors.New("the restock must name the account that paid")
	// While arrived only the lines change (the-lines-stay-editable-until-accepted).
	errRestockArrivedLinesOnly = errors.New("the box has arrived — only its lines can change")
	// Lines can be added once the box has arrived, never removed (lines-can-be-added-not-removed-while-arrived).
	errRestockLineRemoved = errors.New("the box has arrived — a line can be added, not removed")
	// A stored line's supplier and store are closed once the box has arrived (a-line-added-after-arrival-names-its-supplier).
	errRestockArrivedSupplierLocked = errors.New("the box has arrived — a stored line keeps its supplier and store")
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

// restockLogToProto carries one trail row over the wire, its statuses read back from the stored words. "" as the
// from-status is the create, which the wire says as UNSPECIFIED.
func restockLogToProto(l *inventory_service_models.RestockLog) *inventoryv1.RestockLog {
	return &inventoryv1.RestockLog{
		Id:          l.ID,
		FromStatus:  restockStatusFromText(l.FromStatus),
		ToStatus:    restockStatusFromText(l.ToStatus),
		ActorUserId: l.ActorUserID,
		Description: l.Description,
		AtUnix:      l.CreatedAt.Unix(),
	}
}

// problemCounts is how many of one line's units were broken and how many missing.
type problemCounts struct {
	broken  int64
	missing int64
}

// problemCountsByProduct sums a restock's problem rows per product — a product appears once per restock, so a product
// IS its line (a-product-appears-once-per-restock).
func problemCountsByProduct(problems []inventory_service_models.RestockProblemItem) map[uint64]problemCounts {
	out := make(map[uint64]problemCounts, len(problems))

	for i := range problems {
		c := out[problems[i].ProductID]

		switch problems[i].ProblemType {
		case restockProblemBroken:
			c.broken += problems[i].Count
		case restockProblemMissing:
			c.missing += problems[i].Count
		}

		out[problems[i].ProductID] = c
	}

	return out
}

// linePriceUnit is a line's unit price, for display: total ÷ count (a-line-is-typed-as-its-total). The total is the
// truth; this follows it.
func linePriceUnit(total float64, count int64) float64 {
	if count <= 0 {
		return 0
	}

	return total / float64(count)
}

// restockTotals writes what a restock's lines add up to onto the restock, and each line's unit price — every create
// and every edit calls it before saving, so the stored figures never trail the lines. Subtotal is Σ line totals; the
// total adds the freight and never the courier's charge (the-couriers-charge-stays-out-of-total).
func restockTotals(rr *inventory_service_models.Restock) {
	var subtotal float64

	for i := range rr.Items {
		rr.Items[i].PriceUnit = linePriceUnit(rr.Items[i].Total, rr.Items[i].Count)
		subtotal += rr.Items[i].Total
	}

	rr.Subtotal = subtotal
	rr.Total = subtotal + rr.ShipmentCost
}

// optionalID is a wire id as a nullable column: 0 means "not named", which the column says as NULL.
func optionalID(id uint64) *uint64 {
	if id == 0 {
		return nil
	}

	return &id
}

// idOrZero is a nullable column as a wire id: NULL reads as 0, "not named".
func idOrZero(id *uint64) uint64 {
	if id == nil {
		return 0
	}

	return *id
}

func restockRequestToProto(r *inventory_service_models.Restock) *inventoryv1.RestockRequest {
	items := make([]*inventoryv1.RestockRequestItem, 0, len(r.Items))

	// The problem rows are the restock's, keyed by product; each goes under its line. Empty unless the caller loaded
	// them, which Detail and the accept do.
	problems := make(map[uint64][]*inventoryv1.RestockProblemItem, len(r.Problems))

	for p := range r.Problems {
		row := &r.Problems[p]

		// The price was filled at accept and stored (the-problem-price-is-filled-by-the-system).
		problems[row.ProductID] = append(problems[row.ProductID], &inventoryv1.RestockProblemItem{
			Type:      restockProblemTypeFromText(row.ProblemType),
			Count:     row.Count,
			PriceUnit: row.PriceUnit,
			Total:     row.Total,
			Note:      row.Note,
		})
	}

	for i := range r.Items {
		src := &r.Items[i]

		item := &inventoryv1.RestockRequestItem{
			Id:        src.ID,
			ProductId: src.ProductID,
			Sku:       src.SKU,
			Name:      src.Name,
			Count:     src.Count,
			Total:     src.Total,
			PriceUnit: src.PriceUnit,
			// What was in the box, broken included (any-warehouse-member-counts-what-arrived).
			ReceivedCount: src.ReceivedCount,
			Problems:      problems[src.ProductID],
		}

		item.SupplierId = idOrZero(src.SupplierID)
		item.SupplierChannelId = idOrZero(src.SupplierChannelID)
		item.Note = src.Note

		for p := range src.Placements {
			item.Placements = append(item.Placements, placementToProto(&src.Placements[p]))
		}

		items = append(items, item)
	}

	out := &inventoryv1.RestockRequest{
		Id:               r.ID,
		RequestingTeamId: r.TeamID,
		WarehouseId:      r.WarehouseID,
		Status:           restockStatusFromText(r.Status),
		CreatedAtUnix:    r.CreatedAt.Unix(),
		Items:            items,
		Receipt:          r.Receipt,
		ReceiptFile:      r.ReceiptFile,
		ShipmentId:       r.ShipmentID,
		InvoiceRefId:     r.InvoiceRefID,
		FinanceAccountId: r.FinanceAccountID,
		TransactionId:    r.TransactionID,
		PaymentType:      restockPaymentFromText(r.PaymentType),
		ShipmentCost:     r.ShipmentCost,
		Subtotal:         r.Subtotal,
		// Goods plus shipping — never the courier's charge (the-couriers-charge-stays-out-of-total).
		Total:            r.Total,
		Note:             r.Note,
		CreatedByUserId:  r.CreatedByUserID,
		AcceptedByUserId: r.AcceptedByUserID,

		CancelledByUserId: r.CancelledByUserID,
		ArrivedByUserId:   r.ArrivedByUserID,
		LostByUserId:      r.LostByUserID,

		// The courier's charge, one per restock with its note (the-courier-is-paid-once-per-restock).
		WarehouseAdditionalCost:     r.WarehouseAdditionalCost,
		WarehouseAdditionalCostNote: r.WarehouseAdditionalCostNote,
	}

	// THE TRAIL, oldest first — empty unless the caller preloaded it, which only Detail does.
	for i := range r.Logs {
		out.Logs = append(out.Logs, restockLogToProto(&r.Logs[i]))
	}

	// NULL means "it has not happened", which the wire says as 0, not as the zero time.Time.
	if r.AcceptedAt != nil {
		out.AcceptedAtUnix = r.AcceptedAt.Unix()
	}

	if r.CancelledAt != nil {
		out.CancelledAtUnix = r.CancelledAt.Unix()
	}

	if r.ArrivedAt != nil {
		out.ArrivedAtUnix = r.ArrivedAt.Unix()
	}

	if r.LostAt != nil {
		out.LostAtUnix = r.LostAt.Unix()
	}

	return out
}

// restockItemModels turns request lines into rows. The fields a line READS BACK after accept — received_count,
// placements, problems — are deliberately NOT read: only the warehouse writes them, and only by counting at the door.
// Nor is price_unit: it is worked out from the total (linePriceUnit), never taken from the caller.
func restockItemModels(in []*inventoryv1.RestockRequestItem) []inventory_service_models.RestockItem {
	out := make([]inventory_service_models.RestockItem, 0, len(in))
	for _, item := range in {
		out = append(out, inventory_service_models.RestockItem{
			ProductID:         item.GetProductId(),
			SKU:               item.GetSku(),
			Name:              item.GetName(),
			Count:             item.GetCount(),
			Total:             item.GetTotal(),
			PriceUnit:         linePriceUnit(item.GetTotal(), item.GetCount()),
			SupplierID:        optionalID(item.GetSupplierId()),
			SupplierChannelID: optionalID(item.GetSupplierChannelId()),
			Note:              item.GetNote(),
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
	case errors.Is(err, errRestockStoreMissing):
		// NotFound for the same reason: another team's store must be indistinguishable from one that does not exist.
		return connect.NewError(connect.CodeNotFound, errRestockStoreMissing)
	case errors.Is(err, errRestockNotOngoing),
		errors.Is(err, errRestockNotAcceptable),
		errors.Is(err, errRestockNotAccepted),
		errors.Is(err, errRestockNoItems),
		errors.Is(err, errRestockNotEditable),
		errors.Is(err, errRestockNotArrivable),
		errors.Is(err, errRestockArrivedLinesOnly),
		errors.Is(err, errRestockLineRemoved),
		errors.Is(err, errRestockArrivedSupplierLocked):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errRestockCountIncomplete),
		errors.Is(err, errRestockOverCount),
		errors.Is(err, errRestockBrokenOverReceived),
		errors.Is(err, errRestockLineNoPlace),
		errors.Is(err, errRestockPlacementMismatch),
		errors.Is(err, errRestockPlacementDuplicate),
		errors.Is(err, errRestockCostNoteMissing),
		errors.Is(err, errRestockProductTwice),
		errors.Is(err, errRestockProductNotOwned),
		errors.Is(err, errRestockAccountRequired),
		errors.Is(err, errRestockStoreWithoutSupplier),
		errors.Is(err, errRestockStoreNotTheSuppliers):
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

// recordRestockLog appends one row to a restock's trail (00024), IN THE SAME TRANSACTION as the change it describes,
// carrying the same instant as the column the handler stamps. An edit passes the same status twice
// (edits-are-in-the-same-trail); a create passes "" as the from-status.
func recordRestockLog(
	tx *gorm.DB,
	requestID uint64,
	from, to string,
	actor uint64,
	description string,
	at time.Time,
) error {
	_, err := recordRestockLogRow(tx, requestID, from, to, actor, description, at)

	return err
}

// recordRestockLogRow is recordRestockLog returning the row it wrote — its id names an edit's event, one per edit.
func recordRestockLogRow(
	tx *gorm.DB,
	requestID uint64,
	from, to string,
	actor uint64,
	description string,
	at time.Time,
) (inventory_service_models.RestockLog, error) {
	row := inventory_service_models.RestockLog{
		RestockID:   requestID,
		FromStatus:  from,
		ToStatus:    to,
		ActorUserID: actor,
		Description: description,
		CreatedAt:   at,
	}

	err := tx.Create(&row).Error

	return row, err
}
