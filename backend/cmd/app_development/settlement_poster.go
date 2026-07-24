package main

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// settlementPoster joins inventory_service to settlement_service (#184): accepting a COD restock
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
type settlementPoster struct {
	settlement *settlement_v1.Service
}

func NewSettlementPoster(settlement *settlement_v1.Service) inventory_v1.SettlementPoster {
	return &settlementPoster{settlement: settlement}
}

func (p *settlementPoster) PostCODFee(
	ctx context.Context,
	tx *gorm.DB,
	sellingTeamID, warehouseID, restockRequestID uint64,
	amount int64,
) error {
	_, err := p.settlement.PostEntry(ctx, tx, settlement_v1.Posting{
		// The team that asked for the restock owes; the warehouse that paid the courier is owed.
		DebtorTeamID:   sellingTeamID,
		CreditorTeamID: warehouseID,
		Amount:         amount,
		SourceType:     settlement_v1.SourceTypeCODFee,
		SourceID:       restockRequestID,
	})

	// ALREADY POSTED IS A NORMAL ANSWER, not a failure — and swallowing it here rather than in the
	// ledger is deliberate. An acceptance that somehow ran twice must not fail on the second attempt
	// over a debt that is already correctly recorded; the ledger's job is to refuse the duplicate,
	// and this caller's job is to decide that refusing is fine.
	if errors.Is(err, settlement_v1.ErrAlreadyPosted) {
		return nil
	}

	return err
}
