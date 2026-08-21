package inventory_v1

import (
	"context"

	"gorm.io/gorm"
)

// SettlementPoster is how inventory_service records that a WAREHOUSE IS OWED MONEY (#184).
//
// It exists for one obligation that already happens today and goes unrecorded: receiving a delivery
// costs the warehouse money — the courier's fee at the door, and whatever else it pays to get the
// goods in — spent on goods belonging to the requesting team. Those numbers already reach the order's
// COGS (#155) — correct for costing, and silent on who is owed them.
//
// An INTERFACE THIS SERVICE OWNS, in this service's own terms, for the same reason selling_service
// declares `StockPicker`: inventory must never import settlement_service, and the implementation
// lives in the composition root where knowing about two services is the entire job.
//
// ⚠ IT TAKES THE CALLER'S TRANSACTION, which is the one thing that makes it different from
// StockPicker — and it is a deliberate difference, not an inconsistency:
//
//   - selling→inventory CANNOT be atomic. Stock is another service's commit, so that path takes the
//     stock and COMPENSATES if the order then fails.
//   - inventory→settlement CAN be. Both tables live in the same database, so the acceptance and the
//     obligation are one transaction and there is nothing to compensate.
//
// Atomicity here is required rather than nice. If the stock movement commits and the obligation does
// not, the warehouse is out of pocket with no record — which is EXACTLY the situation this service
// was built to fix, reproduced by the code meant to fix it.
//
// The cost of passing a transaction across a service boundary is real and worth naming: the two
// services are no longer independently deployable while this call is in-process. The day settlement
// moves to its own database, this becomes an event and the atomicity argument has to be re-made — at
// which point the reconciliation report (#187) is what covers the gap.
type SettlementPoster interface {
	// PostRestockOutlay records that `sellingTeamID` owes `warehouseID` what the warehouse laid out to
	// receive restock request `restockRequestID` — the SUM of that request's cost lines.
	//
	// ONE CALL PER DELIVERY, not per cost line. The debt is for the delivery; the breakdown of why
	// lives on the restock beside the goods, and posting per line would make the ledger's `source_id`
	// name a cost row while every other source names a business object.
	//
	// It must be IDEMPOTENT on the restock request: an acceptance that is somehow retried must not
	// charge twice. A movement already recorded is a normal answer, not an error.
	PostRestockOutlay(
		ctx context.Context,
		tx *gorm.DB,
		sellingTeamID, warehouseID, restockRequestID uint64,
		amount int64,
	) error

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
		ownerTeamID, warehouseID, movementID uint64,
		amount int64,
		reversal bool,
	) error
}

// noSettlement is what a Service built without a poster uses: it drops the posting on the floor.
//
// Deliberately a no-op rather than a nil check at the call site. Inventory's own job — receiving
// goods onto shelves — must not fail because a downstream ledger was not wired up, and a unit test
// that cares about racks should not have to construct a settlement service to receive a box.
//
// It is NOT the production default: the composition root wires the real one, and the day this silently
// runs in production is the day COD obligations stop being recorded. That is what #187 exists to catch.
type noSettlement struct{}

func (noSettlement) PostRestockOutlay(context.Context, *gorm.DB, uint64, uint64, uint64, int64) error {
	return nil
}

func (noSettlement) PostStockDamage(
	context.Context, *gorm.DB, uint64, uint64, uint64, int64, bool,
) error {
	return nil
}
