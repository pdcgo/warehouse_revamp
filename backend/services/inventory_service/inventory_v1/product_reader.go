package inventory_v1

import (
	"context"
	"fmt"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// ProductFact is what inventory needs to know about a product it is asked to stock, take or transfer: who owns it, the
// owner's rules for other teams (the-take-checks-the-product-first), and what a transfer line snapshots.
type ProductFact struct {
	// The selling team that owns it.
	TeamID uint64
	// The owner's lock: no other team may sell it (the shared lock, `cross_locked`).
	Private bool
	// Below this many units in total, other teams are stopped (the-reserve-stops-other-teams-at-low-stock).
	ReservedStock int64
	// The markup another team pays over cost, in basis points (inventory-computes-the-markup).
	CrossMarkupBps uint32
	// What a transfer line snapshots at create.
	SKU  string
	Name string
}

// ProductReader answers ProductFacts by id — asked of product_service, which owns products. An id that exists nowhere is
// absent from the map. callerTeamID is the CALLER's scope for the question. See product_reader.go in the composition
// root.
type ProductReader interface {
	Facts(ctx context.Context, callerTeamID uint64, productIDs []uint64) (map[uint64]ProductFact, error)
}

// factsUnchecked is a nil ProductReader's stand-in: every product is the asking team's own, with no lock, reserve or
// markup. Right for a test that stocks its own team's products and has no product_service; the composition root always
// wires the real one.
type factsUnchecked struct{}

func (factsUnchecked) Facts(_ context.Context, callerTeamID uint64, productIDs []uint64) (map[uint64]ProductFact, error) {
	facts := make(map[uint64]ProductFact, len(productIDs))
	for _, id := range productIDs {
		facts[id] = ProductFact{TeamID: callerTeamID}
	}

	return facts, nil
}

// ownProductsOnly refuses a restock line on a product the team does not own: a restock carries only the team's own
// products, so every unit in stock has exactly one owner (a-restock-carries-only-the-teams-own-products). Asked BEFORE
// any transaction, as the supplier is: a call to another service never runs under a lock.
func (s *Service) ownProductsOnly(ctx context.Context, teamID uint64, items []*inventoryv1.RestockRequestItem) error {
	if len(items) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.GetProductId())
	}

	facts, err := s.products.Facts(ctx, teamID, ids)
	if err != nil {
		return fmt.Errorf("ask product facts: %w", err)
	}

	for _, id := range ids {
		fact, ok := facts[id]
		if !ok || fact.TeamID != teamID {
			return fmt.Errorf("%w: product %d", errRestockProductNotOwned, id)
		}
	}

	return nil
}
