package liability_v1

import (
	"context"
	"errors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// TransferCourierCharge is what the courier asked at the RECEIVING warehouse's door for a warehouse transfer, as
// *Warehouse Transfer Accepted* announces it (balance-posts-the-transfers-on-site-debt-from-the-event): the selling team
// owes the warehouse that paid it. Not the wire type — the push handler translates, so the ledger's domain does not
// depend on another service's contract.
//
// The restock's CourierCharge is the model; this is its transfer-side twin, keyed by the TRANSFER.
type TransferCourierCharge struct {
	TransferID    uint64
	SellingTeamID uint64
	// The warehouse that RECEIVED the transfer (B, `to_warehouse_id`) — the door the courier was paid at.
	WarehouseID uint64
	Amount      float64
	// Who counted it in — read from the stored transfer, never from the envelope (every-entry-names-who-posted-it).
	ActorID uint64
}

// ChargeTransferCourier posts what the selling team owes the receiving warehouse for the courier's charge at its door,
// ONE posting per transfer: a `transfer_fee` keyed by the transfer (a-transfer-charge-is-a-transfer-fee), so a redelivered
// or re-published event posts nothing new. Nothing is posted for 0 — the event is published after every accept.
//
// ⚠ ITS OWN SOURCE TYPE, not the restock's `incidental_fee`. That one is keyed by a restock id, and the idempotency key
// is (team, counterparty, source_type, source_id, reversal): transfer 41 and restock 41 for the same pair would collide,
// and the second charge would be swallowed as a redelivery of the first.
func (s *Service) ChargeTransferCourier(ctx context.Context, c TransferCourierCharge) error {
	// Nothing is owed for 0 — and nothing to oneself: a team that is its own receiving warehouse paid its own courier.
	// PostEntry refuses one team on both sides, and an error here would NACK a redelivery that can never succeed.
	if !san_money.Positive(c.Amount) || c.SellingTeamID == c.WarehouseID {
		return nil
	}

	_, err := s.PostEntry(ctx, nil, Posting{
		DebtorTeamID:   c.SellingTeamID,
		CreditorTeamID: c.WarehouseID,
		Amount:         c.Amount,
		SourceType:     SourceTypeTransferFee,
		SourceID:       c.TransferID,
		ActorID:        c.ActorID,
	})

	// A redelivery: the debt is already on the books, which is the right answer, not a failure.
	if errors.Is(err, ErrAlreadyPosted) {
		return nil
	}

	return err
}
