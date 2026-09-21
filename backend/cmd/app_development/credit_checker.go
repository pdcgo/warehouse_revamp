package main

import (
	"context"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// creditChecker joins selling_service to liability_service (#189): an order is refused when one of
// the teams it would put in debt has hit the limit that team set.
//
// Same shape as liabilityPoster and stockPicker beside it — the composition root is the one place
// allowed to know about two services at once, selling declares the interface it needs in its own
// terms, and this adapter is the whole dependency between them.
//
// Like the poster, it calls a DOMAIN function rather than an RPC handler. Unlike the poster it takes
// no transaction, and that is the point: this is a READ taken before anything is written, so there is
// nothing to be atomic with. Making it part of the order's transaction would hold that row lock across
// another service's call and still not close the window — the balance can move the instant after it
// is read either way.
type creditChecker struct {
	liability *liability_v1.Service
}

func NewCreditChecker(liability *liability_v1.Service) selling_v1.CreditChecker {
	return &creditChecker{liability: liability}
}

func (c *creditChecker) Check(
	ctx context.Context,
	teamID uint64,
	creditorTeamIDs []uint64,
) (*selling_v1.CreditBlock, error) {
	block, err := c.liability.CheckCredit(ctx, teamID, creditorTeamIDs)
	if err != nil {
		return nil, err
	}

	// Translated rather than passed through: selling_service never imports liability's types, so the
	// two CreditBlocks are different structs on purpose. This is the seam that keeps them apart.
	if block == nil {
		return nil, nil
	}

	return &selling_v1.CreditBlock{
		CreditorTeamID: block.CreditorTeamID,
		Debt:           block.Debt,
		Limit:          block.Limit,
	}, nil
}
