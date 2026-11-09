package inventory_v1

import (
	"context"
	"errors"
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
	ProductCode string
	Name        string
}

// ProductReader answers ProductFacts by id — asked of product_service, which owns products. An id that exists nowhere is
// absent from the map. callerTeamID is the CALLER's scope for the question. See product_reader.go in the composition
// root.
type ProductReader interface {
	Facts(ctx context.Context, callerTeamID uint64, productIDs []uint64) (map[uint64]ProductFact, error)
	// Search finds, AMONG the given products only, those — archived ones too, flagged — whose name or product code contains the term — one
	// window by name, and how many match in all (a-warehouse-picks-only-what-it-has-held). An EMPTY term lists the whole
	// set in the same order (the-stock-screen-lists-what-the-warehouse-has-held). Inventory knows which products have been
	// in a warehouse; product_service names and searches them, so no name is mirrored here (HARD RULE 3).
	Search(ctx context.Context, callerTeamID uint64, search ProductSearch) (ProductSearchPage, error)
}

// ProductSearch is one search among a known set of products. Q empty = every product of the set.
type ProductSearch struct {
	ProductIDs []uint64
	Q          string
	Offset     int
	Limit      int
}

// ProductSearchPage is one window of a ProductSearch, in its order, and the count of every match.
type ProductSearchPage struct {
	Products []ProductMatch
	Total    int64
}

// ProductMatch is a product a search found: what a picker snapshots, its owner, and whether its seller archived it
// (an-archived-product-held-here-can-be-picked).
type ProductMatch struct {
	ID          uint64
	TeamID      uint64
	ProductCode string
	Name        string
	Archived    bool
}

// errNoProductSearch is a nil ProductReader's answer to a search: it knows no names to search.
var errNoProductSearch = errors.New("no product service to search")

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

// Search refuses: with no product_service there are no names or codes to match, and answering nothing would read as
// "this warehouse has held none of it".
func (factsUnchecked) Search(context.Context, uint64, ProductSearch) (ProductSearchPage, error) {
	return ProductSearchPage{}, errNoProductSearch
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
