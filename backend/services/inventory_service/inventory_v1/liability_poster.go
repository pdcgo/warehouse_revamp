package inventory_v1

import (
	"context"

	"gorm.io/gorm"
)

// LiabilityPoster is how inventory_service records that one team owes another over stock it holds — today, only that the
// WAREHOUSE owes the owning team for goods it broke or lost.
//
// An INTERFACE THIS SERVICE OWNS, in this service's own terms, for the same reason selling_service declares
// `StockPicker`: inventory must never import liability_service, and the implementation lives in the composition root.
//
// ⚠ The courier's charge at the door is no longer posted through here: balance posts it from *Restock Accepted*
// (balance-posts-the-couriers-debt-from-the-event), and the accept never writes balance's tables.
type LiabilityPoster interface {
	// PostStockDamage records that `warehouseID` owes `ownerTeamID` the value of stock it broke or lost
	// while holding it, valued at the batch's frozen cost (business_level Â§Warehouse 5).
	//
	// ⚠ THE DIRECTION IS THE OPPOSITE OF EVERY OTHER POSTING FROM THIS SERVICE. Elsewhere the selling
	// team owes the warehouse; here the WAREHOUSE owes the selling team. The goods were never the
	// warehouse's — it holds them, the selling team owns them — so losing them is a debt, not a
	// discount.
	//
	// ⚠ IT IS NOT THE SAME RECORD AS THE EXPENSE. ExpensePoster writes the warehouse's own P&L view of
	// the same event; this writes who it now owes. Both are correct: one answers "what did our losses
	// cost us", the other "who do we have to pay". Dropping either loses a real question's answer.
	//
	// `reversal` is true when the goods were FOUND again — the reimbursement is given back as a
	// compensating entry, never by deleting the original, so the history reads as one story.
	//
	// `movementID` is the idempotency anchor: every adjust writes exactly one movement, so a retried
	// adjust cannot charge twice, and a damage and its later find never collide.
	PostStockDamage(
		ctx context.Context,
		tx *gorm.DB,
		ownerTeamID, warehouseID, movementID, actorID uint64,
		amount int64,
		kind StockDamageKind,
	) error
}

// noLiability is what a Service built without a poster uses: it drops the posting on the floor.
//
// Deliberately a no-op rather than a nil check at the call site. Inventory's own job — receiving
// goods onto shelves — must not fail because a downstream ledger was not wired up, and a unit test
// that cares about racks should not have to construct a liability service to receive a box.
//
// It is NOT the production default: the composition root wires the real one, and the day this silently
// runs in production is the day COD obligations stop being recorded. That is what #187 exists to catch.
type noLiability struct{}

// StockDamageKind — WHICH custody movement a posting records, in this service's own terms.
//
// ⚠ IT REPLACED A BOOLEAN. The parameter used to be `reversal`, which said only whether the money was
// going back — so broken and lost arrived at the ledger as one indistinguishable thing and "how much
// went to breakage versus shrinkage" was unanswerable (the-ledger-speaks-the-business-words). The
// distinction was already here: `StockAdjustReason` carries DAMAGED, LOST and FOUND, and this call
// site was collapsing all three.
type StockDamageKind int

const (
	// Goods the warehouse BROKE while holding them. The warehouse owes the owner.
	StockDamageBroken StockDamageKind = iota
	// Goods the warehouse LOST while holding them — shrinkage. Same direction, different question.
	StockDamageLost
	// Goods reimbursed and then FOUND AGAIN. It is the giving-back movement, so it posts as a
	// reversal — the flag the ledger still keeps, now carried by the kind rather than by the caller.
	StockDamageFound
)

func (noLiability) PostStockDamage(
	context.Context, *gorm.DB, uint64, uint64, uint64, uint64, int64, StockDamageKind,
) error {
	return nil
}
