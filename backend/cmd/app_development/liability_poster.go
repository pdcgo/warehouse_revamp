package main

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// liabilityPoster joins inventory_service to liability_service (#184): accepting a COD restock
// records that the requesting team owes the warehouse what it paid at the door.
//
// Same shape as stockPicker and productCatalog beside it — the composition root is the one place
// allowed to know about two services at once, inventory declares the interface it needs in its own
// terms, and this adapter is the whole dependency between them.
//
// It differs from those two in one way: it calls a DOMAIN function rather than an RPC handler,
// passing the caller's transaction straight through. `PostEntry` is not an RPC and deliberately is
// not one — nothing outside this system may assert that a team owes another team, so the ledger's
// write path has no wire surface at all. Every posting comes from a real event inside the system.
type liabilityPoster struct {
	liability *liability_v1.Service
}

func NewLiabilityPoster(liability *liability_v1.Service) inventory_v1.LiabilityPoster {
	return &liabilityPoster{liability: liability}
}

func (p *liabilityPoster) PostRestockOutlay(
	ctx context.Context,
	tx *gorm.DB,
	sellingTeamID, warehouseID, restockRequestID, actorID uint64,
	amount int64,
) error {
	_, err := p.liability.PostEntry(ctx, tx, liability_v1.Posting{
		// The team that asked for the restock owes; the warehouse that paid the courier is owed.
		DebtorTeamID:   sellingTeamID,
		CreditorTeamID: warehouseID,
		Amount:         amount,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       restockRequestID,
		// The warehouse person who accepted the delivery — computed by the fulfil handler for its own
		// records, and until now dropped at this boundary (every-entry-names-who-posted-it).
		ActorID: actorID,
	})

	// ALREADY POSTED IS A NORMAL ANSWER, not a failure — and swallowing it here rather than in the
	// ledger is deliberate. An acceptance that somehow ran twice must not fail on the second attempt
	// over a debt that is already correctly recorded; the ledger's job is to refuse the duplicate,
	// and this caller's job is to decide that refusing is fine.
	if errors.Is(err, liability_v1.ErrAlreadyPosted) {
		return nil
	}

	return err
}

// PostStockDamage records that the WAREHOUSE owes the OWNING TEAM for stock it broke or lost while
// holding it (business_level §Warehouse 5).
//
// ⚠ NOTE THE DIRECTION — it is the reverse of every other posting in this file. Elsewhere the selling
// team owes the warehouse; here the warehouse is the debtor, because the goods it lost were never
// its own. Getting this backwards would charge the victim.
func (p *liabilityPoster) PostStockDamage(
	ctx context.Context,
	tx *gorm.DB,
	ownerTeamID, warehouseID, movementID, actorID uint64,
	amount int64,
	kind inventory_v1.StockDamageKind,
) error {
	sourceType := liability_v1.SourceTypeBrokenGood

	switch kind {
	case inventory_v1.StockDamageLost:
		sourceType = liability_v1.SourceTypeLostGood
	case inventory_v1.StockDamageFound:
		sourceType = liability_v1.SourceTypeFound
	}

	_, err := p.liability.PostEntry(ctx, tx, liability_v1.Posting{
		// The warehouse broke it, so the warehouse owes; the team that owns the goods is owed.
		DebtorTeamID:   warehouseID,
		CreditorTeamID: ownerTeamID,
		Amount:         amount,
		SourceType:     sourceType,
		SourceID:       movementID,
		// A FOUND adjust gives the reimbursement back as a compensating entry against its own
		// movement, never by deleting the one that charged it. ⚠ The TYPE carries the cause and the
		// FLAG carries the direction — both stay in the idempotency key, so they are not redundant.
		Reversal: kind == inventory_v1.StockDamageFound,
		// The warehouse person who recorded the adjust.
		ActorID: actorID,
	})

	// Already posted is a normal answer here for the same reason it is above: an adjust that somehow
	// ran twice must not fail over a debt that is already correctly recorded.
	if errors.Is(err, liability_v1.ErrAlreadyPosted) {
		return nil
	}

	return err
}
