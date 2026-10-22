package liability_v1

import (
	"context"
	"errors"
)

// CourierCharge is a restock's courier charge at the door, as *Restock Accepted* announces it: the selling team owes the
// warehouse that paid it. Not the wire type — the push handler translates, so the ledger's domain does not depend on
// another service's contract.
type CourierCharge struct {
	RestockID     uint64
	SellingTeamID uint64
	WarehouseID   uint64
	Amount        int64
	// Who counted the box in — read from the stored restock, never from the envelope (every-entry-names-who-posted-it).
	ActorID uint64
}

// ChargeRestockCourier posts what the selling team owes the warehouse for the courier's charge, ONE posting per
// restock (balance-posts-the-couriers-debt-from-the-event): an `incidental_fee` keyed by the restock, so a redelivered
// event posts nothing new. Nothing is posted for 0 — an entry of zero reads as a debt of nothing.
func (s *Service) ChargeRestockCourier(ctx context.Context, c CourierCharge) error {
	if c.Amount <= 0 {
		return nil
	}

	_, err := s.PostEntry(ctx, nil, Posting{
		DebtorTeamID:   c.SellingTeamID,
		CreditorTeamID: c.WarehouseID,
		Amount:         c.Amount,
		SourceType:     SourceTypeIncidentalFee,
		SourceID:       c.RestockID,
		ActorID:        c.ActorID,
	})

	// A redelivery: the debt is already on the books, which is the right answer, not a failure.
	if errors.Is(err, ErrAlreadyPosted) {
		return nil
	}

	return err
}
