package selling_v1

import "context"

// CreditBlock is one creditor refusing this team any more credit, in this service's own terms (#189).
//
// It is a VALUE, not an error, because the order form has to show it: "blocked" is not actionable,
// "Warehouse Jakarta: you owe 52.000.000 of a 50.000.000 limit" is. The person hitting this is
// customer service, who never sees the Liability screens and cannot look the numbers up.
type CreditBlock struct {
	CreditorTeamID uint64
	// What this team owes that creditor, as a POSITIVE number — the ledger's sign convention stops at
	// this boundary rather than reaching a screen.
	Debt int64
	// The limit that was hit. 0 is a real value: no credit at all.
	Limit int64
}

// CreditChecker asks settlement_service whether this team may take on more debt (#189).
//
// An INTERFACE THIS SERVICE OWNS, expressed in this service's own types, for exactly the reason
// StockPicker is: selling_service must never import settlement_service, and the implementation lives
// in the composition root where knowing about both is the entire job.
//
// ⚠ IT IS A PRE-CHECK, NOT A GUARD ON THE LEDGER. The ledger records what happened and never declines
// to record it; the ORDER FLOW chooses to gate itself. That is why this is a separate call before the
// transaction rather than a failure returned by the posting — an order that slips through still has
// its fees recorded truthfully, and the NEXT one is the one that is stopped.
//
// ⚠ IT IS ALSO ADVISORY BY CONSTRUCTION. The balance it reads may be a moment stale (§3.3 accepts a
// window where an order has committed and its fees have not yet posted), so exposure can reach the
// limit plus about one order. That overshoot is what the `debt < limit` rule already permits, not a
// hole in it — the two decisions agree instead of fighting.
type CreditChecker interface {
	// Check reports the FIRST creditor refusing `teamID` more credit, or nil if every one allows it.
	//
	// `creditorTeamIDs` is the fulfilling warehouse plus each team owning a product on the order. Any
	// one over its limit stops the whole order, and the result names WHICH — a block nobody can
	// attribute is a block nobody can clear.
	Check(ctx context.Context, teamID uint64, creditorTeamIDs []uint64) (*CreditBlock, error)
}

// noCredit is what a Service built without a checker uses: everything is allowed.
//
// Deliberately permissive rather than a nil check at the call site, and deliberately NOT the
// production default — the composition root wires the real one. Placing an order must not fail
// because a downstream ledger was not wired up, and a unit test about shops should not have to
// construct a settlement service to sell something.
type noCredit struct{}

func (noCredit) Check(context.Context, uint64, []uint64) (*CreditBlock, error) {
	return nil, nil
}
