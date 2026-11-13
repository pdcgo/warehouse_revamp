package inventory_v1

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// KOREKSI JUMLAH TERIMA — what RestockReceivedCountCorrect and WarehouseTransferReceivedCountCorrect share: the
// refusals before any lock, the per-line judgement under the parent row's lock, the error mapping, and the history
// label every ledger read draws (docs/business/inventory/adjustment_decision.md —
// the-received-count-prototype-is-accepted: who, the form, the refusals, the result). The form's own copy of these
// rules is frontend/src/features/receivedCount/rules.ts; the server is the boundary.

// countReasonMaxLen is the reason's limit, in characters, as the proto says.
const countReasonMaxLen = 200

var (
	errCountReasonMissing = errors.New("a received-count correction needs a reason")
	errCountReasonTooLong = errors.New("the reason is at most 200 characters")
	errCountLineTwice     = errors.New("lines: a line is corrected at most once per correction")
	errCountLineUnknown   = errors.New("lines: not a line of this restock or transfer")
	errCountNotAccepted   = errors.New("only an accepted stock-in's received count is corrected")
	errCountStale         = errors.New("the line's received count changed since the form opened")
	errCountNoChange      = errors.New("nothing to correct")
	errCountBelowBroken   = errors.New("the real count is below the broken units")
	errCountOverLine      = errors.New("the real count is above what the line says")
)

// countReason is the request's reason trimmed — refused empty or only spaces, or over 200 characters. A handler called
// directly gets no validation interceptor, so the length is checked here too.
func countReason(raw string) (string, error) {
	reason := strings.TrimSpace(raw)

	if reason == "" {
		return "", errCountReasonMissing
	}

	if utf8.RuneCountInString(reason) > countReasonMaxLen {
		return "", errCountReasonTooLong
	}

	return reason, nil
}

// countLines refuses a line named twice, before anything is locked.
func countLines(lines []*inventoryv1.ReceivedCountLine) error {
	seen := make(map[uint64]bool, len(lines))

	for _, line := range lines {
		if seen[line.GetItemId()] {
			return errCountLineTwice
		}

		seen[line.GetItemId()] = true
	}

	return nil
}

// judgeCountLine is ONE line's rules, in the order the form shows them (rules.ts lineEffect), judged under the parent
// row's lock against the line as stored:
//
//	stale          the count the form showed is no longer the line's — someone corrected it first
//	no change      the real count is the line's count
//	below broken   0 ≤ broken ≤ received (any-warehouse-member-counts-what-arrived)
//	over the line  never above what was ordered or sent (accept-refuses-more-than-the-line-says); a unit over the line
//	               found later is found stock, Adjust › Found (the-received-count-prototype-is-accepted)
//
// The batch and the rack are judged by the posting, under their own locks (post_received_count.go).
func judgeCountLine(line *inventoryv1.ReceivedCountLine, code string, current, broken, ceiling int64, ceilingWord string) error {
	counted := line.GetReceivedCount()

	if line.GetExpectedReceivedCount() != current {
		return fmt.Errorf("%w: %s now reads %d received, not %d — someone corrected it first; reload and correct again",
			errCountStale, code, current, line.GetExpectedReceivedCount())
	}

	if counted == current {
		return fmt.Errorf("%w: %s already reads %d received", errCountNoChange, code, current)
	}

	if counted < broken {
		return fmt.Errorf("%w: %s has %d broken in the box — the real count is at least %d", errCountBelowBroken, code, broken, broken)
	}

	if counted > ceiling {
		return fmt.Errorf("%w: %s — %d %s; a unit over the line is found stock: Adjust › Found",
			errCountOverLine, code, ceiling, ceilingWord)
	}

	return nil
}

// countRefusal maps a correction's own refusals; nil for anything else, which the restock's or transfer's own mapper
// then answers.
func countRefusal(err error) error {
	if refused := countedRefusal(err); refused != nil {
		return refused
	}

	switch {
	case errors.Is(err, errCountReasonMissing),
		errors.Is(err, errCountReasonTooLong),
		errors.Is(err, errCountLineTwice),
		errors.Is(err, errCountLineUnknown),
		errors.Is(err, errCountNoChange),
		errors.Is(err, errCountBelowBroken),
		errors.Is(err, errCountOverLine):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errCountNotAccepted),
		errors.Is(err, errCountStale),
		errors.Is(err, inventory_mutations.ErrCountOverBatch),
		errors.Is(err, inventory_mutations.ErrCountOverRack):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errRackMissing):
		// Another warehouse's rack is indistinguishable from one that does not exist.
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	default:
		return nil
	}
}

// correctionToProto is one correction history row on the wire; its money only for the owning team
// (a-warehouse-sees-no-seller-money).
func correctionToProto(
	id, itemID, productID uint64,
	from, to, unitsOut int64,
	batchID, placementID uint64,
	reason string,
	actor uint64,
	override bool,
	at int64,
	transactionID uint64,
	total float64,
	withMoney bool,
) *inventoryv1.ReceivedCountCorrection {
	out := &inventoryv1.ReceivedCountCorrection{
		Id: id, ItemId: itemID, ProductId: productID, FromCount: from, ToCount: to, UnitsOut: unitsOut,
		BatchId: batchID, PlacementId: placementID, Reason: reason, ActorUserId: actor, IsOverride: override,
		AtUnix: at, TransactionId: transactionID,
	}

	if withMoney {
		price := 0.0
		if unitsOut != 0 {
			price = total / float64(unitsOut)
		}

		out.PriceUnit = &price
		out.Total = &total
	}

	return out
}

// lineShelves is the racks holding each of the owner's products in the warehouse, with units, rack id order — the
// correction form's "from a rack the batch sits on". ONE statement.
func lineShelves(db *gorm.DB, warehouseID, teamID uint64, productIDs []uint64) (map[uint64][]*inventoryv1.ReceivedCountShelf, error) {
	out := map[uint64][]*inventoryv1.ReceivedCountShelf{}
	if len(productIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		ProductID   uint64
		PlacementID uint64
		StockCount  int64
	}

	err := db.
		Table("product_placements").
		Select("product_id, placement_id, stock_count").
		Where("warehouse_id = ? AND team_id = ? AND product_id IN ? AND stock_count > 0", warehouseID, teamID, productIDs).
		Order("product_id, placement_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, r := range rows {
		out[r.ProductID] = append(out[r.ProductID], &inventoryv1.ReceivedCountShelf{PlacementId: r.PlacementID, Units: r.StockCount})
	}

	return out, nil
}

// batchHolds is each batch's units left, by id. ONE statement.
func batchHolds(db *gorm.DB, ids []uint64) (map[uint64]int64, error) {
	out := map[uint64]int64{}
	if len(ids) == 0 {
		return out, nil
	}

	var rows []struct {
		ID         uint64
		StockCount int64
	}

	err := db.Table("batches").Select("id, stock_count").Where("id IN ?", ids).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, r := range rows {
		out[r.ID] = r.StockCount
	}

	return out, nil
}

// ── The history label (MovementCountCorrection) ─────────────────────────────────────────────────────────────────────

// countCorrectionTypes are the log change types a received-count correction writes — ADJUST rows that carry a label.
var countCorrectionTypes = map[string]bool{models.ChangeRestockCorrection: true, models.ChangeTransferCorrection: true}

type labelKey struct {
	TransactionID uint64
	ProductID     uint64
}

// countCorrectionLabels is the label of every correction row on a history page — keyed by its transaction and
// product: the line's count before and after, the reason, and the restock or transfer. ONE statement, by the
// corrections' transaction index; none when the page holds no correction row.
func countCorrectionLabels(db *gorm.DB, keys []labelKey) (map[labelKey]*inventoryv1.MovementCountCorrection, error) {
	out := map[labelKey]*inventoryv1.MovementCountCorrection{}
	if len(keys) == 0 {
		return out, nil
	}

	ids := make([]uint64, 0, len(keys))
	for _, k := range keys {
		ids = append(ids, k.TransactionID)
	}

	var rows []struct {
		TransactionID uint64
		ProductID     uint64
		FromCount     int64
		ToCount       int64
		Reason        string
		RestockID     uint64
		TransferID    uint64
	}

	err := db.Raw(`
(SELECT DISTINCT ON (transaction_id, product_id) transaction_id, product_id, from_count, to_count, reason,
        restock_id, 0::bigint AS transfer_id
 FROM restock_count_corrections WHERE transaction_id IN ? ORDER BY transaction_id, product_id, id)
UNION ALL
(SELECT DISTINCT ON (transaction_id, product_id) transaction_id, product_id, from_count, to_count, reason,
        0::bigint AS restock_id, transfer_id
 FROM warehouse_transfer_count_corrections WHERE transaction_id IN ? ORDER BY transaction_id, product_id, id)`,
		ids, ids).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, r := range rows {
		out[labelKey{TransactionID: r.TransactionID, ProductID: r.ProductID}] = &inventoryv1.MovementCountCorrection{
			FromCount: r.FromCount, ToCount: r.ToCount, Reason: r.Reason, RestockId: r.RestockID, TransferId: r.TransferID,
		}
	}

	return out, nil
}
