package liability_v1

import (
	"context"
	"errors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// ReturnCourierCharge is what the courier asked at the warehouse's door for a RETURNED parcel, as *Order Return
// Accepted* announces it (a-return-may-carry-the-couriers-ask): the selling team owes the warehouse that paid it. Not
// the wire type — the push handler translates, so the ledger's domain does not depend on another service's contract.
//
// The restock's CourierCharge is the model; this is its return-side twin, keyed by the ORDER.
type ReturnCourierCharge struct {
	OrderID       uint64
	SellingTeamID uint64
	// The warehouse that ACCEPTED the return — the door the courier was paid at, which may not be the one the order
	// shipped from (the-accept-records-where-it-was-accepted).
	WarehouseID uint64
	Amount      float64
	// Who accepted the return — read from the accept's timeline row, never from the envelope
	// (every-entry-names-who-posted-it).
	ActorID uint64
	// Whether they accepted it as Root or the Administrator from outside the warehouse, as the accept's row was stamped
	// (an-override-is-stamped-in-every-service). Stamped on both legs beside the actor.
	ActorIsOverride bool
}

// ChargeReturnCourier posts what the selling team owes the warehouse for the courier's charge at a return, ONE posting
// per order: a `return_incidental_fee` keyed by the order, so a redelivered event posts nothing new. Nothing is posted
// for 0 — the common case, the courier rarely asks.
//
// ⚠ ITS OWN SOURCE TYPE, not the restock's `incidental_fee`. That one is keyed by a restock id, and the idempotency key
// is (team, counterparty, source_type, source_id, reversal): an order and a restock with the same number, for the same
// pair, would collide, and the second charge would be swallowed as a redelivery of the first.
func (s *Service) ChargeReturnCourier(ctx context.Context, c ReturnCourierCharge) error {
	// Nothing is owed for 0 — and nothing to oneself: a team that is its own warehouse, accepting its own return, paid
	// its own courier. PostEntry refuses a posting with one team on both sides, and an error here would NACK a
	// redelivery that can never succeed.
	if !san_money.Positive(c.Amount) || c.SellingTeamID == c.WarehouseID {
		return nil
	}

	_, err := s.PostEntry(ctx, nil, Posting{
		DebtorTeamID:   c.SellingTeamID,
		CreditorTeamID: c.WarehouseID,
		Amount:         c.Amount,
		SourceType:     SourceTypeReturnIncidentalFee,
		SourceID:       c.OrderID,
		ActorID:        c.ActorID,
		IsOverride:     c.ActorIsOverride,
	})

	// A redelivery: the debt is already on the books, which is the right answer, not a failure.
	if errors.Is(err, ErrAlreadyPosted) {
		return nil
	}

	return err
}
