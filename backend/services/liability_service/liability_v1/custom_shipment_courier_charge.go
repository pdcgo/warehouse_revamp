package liability_v1

import (
	"context"
	"errors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// CustomShipmentCourierCharge is what the warehouse paid the courier on the spot for a CUSTOM SHIPMENT it handed over,
// when the selling team picked *Gudang bayar* — as *Custom Shipment Handed Over* announces it
// (the-courier-is-paid-by-the-team-or-by-the-warehouse): the selling team owes the warehouse it shipped from. Not the
// wire type — the push handler translates, so the ledger's domain does not depend on another service's contract.
//
// The restock's CourierCharge is the model (*as a restock's courier charge at the door*); this is its parcel-side twin,
// keyed by the CUSTOM SHIPMENT.
type CustomShipmentCourierCharge struct {
	CustomShipmentID uint64
	SellingTeamID    uint64
	// The warehouse the parcel shipped from — the one that paid the courier at the handover.
	WarehouseID uint64
	Amount      float64
	// Who handed it over — read from the stored parcel, never from the envelope (every-entry-names-who-posted-it).
	ActorID uint64
	// Whether they handed it over as Root or the Administrator from outside the warehouse, as inventory stored it
	// (an-override-is-stamped-in-every-service). Stamped on both legs beside the actor.
	ActorIsOverride bool
}

// ChargeCustomShipmentCourier posts what the selling team owes the warehouse for the courier it paid at a custom
// shipment's handover, ONE posting per parcel: a `custom_shipment_fee` keyed by the parcel, so a redelivered or
// re-published event posts nothing new. Nothing is posted for 0 — the warehouse may type 0, and the event is published
// after every handover.
//
// ⚠ ITS OWN SOURCE TYPE, not the restock's `incidental_fee` nor the transfer's `transfer_fee`
// (a-transfer-charge-is-a-transfer-fee): the idempotency key is (team, counterparty, source_type, source_id, reversal),
// and custom shipment 41 beside restock 41 or transfer 41 for the same pair would collide — the second charge swallowed
// as a redelivery of the first.
//
// It never reads WHO paid: the caller passes only a *Gudang bayar* parcel's cost. A *Kami bayar* parcel's courier is an
// expense on the team's own account and never reaches Team Balance (the push handler keeps it out).
func (s *Service) ChargeCustomShipmentCourier(ctx context.Context, c CustomShipmentCourierCharge) error {
	// Nothing is owed for 0 — and nothing to oneself: a team that ships from its own building paid its own courier.
	// PostEntry refuses one team on both sides, and an error here would NACK a redelivery that can never succeed.
	if !san_money.Positive(c.Amount) || c.SellingTeamID == c.WarehouseID {
		return nil
	}

	_, err := s.PostEntry(ctx, nil, Posting{
		DebtorTeamID:   c.SellingTeamID,
		CreditorTeamID: c.WarehouseID,
		Amount:         c.Amount,
		SourceType:     SourceTypeCustomShipmentFee,
		SourceID:       c.CustomShipmentID,
		ActorID:        c.ActorID,
		IsOverride:     c.ActorIsOverride,
	})

	// A redelivery: the debt is already on the books, which is the right answer, not a failure.
	if errors.Is(err, ErrAlreadyPosted) {
		return nil
	}

	return err
}
