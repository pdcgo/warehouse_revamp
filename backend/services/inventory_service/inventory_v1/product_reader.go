package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
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

	// THE REPRINT OF CHANGED CODES (backlog #151; products-have-their-own-tag-list, its 🔄 *what clears*) — product_service
	// owns which products wait for which warehouse's new labels (`product_reprint_waits`) and their `need_reprint_code`;
	// inventory owns the shelves the labels are for. Asked in-process, never over the wire:
	//
	// ReprintWaits is one page of the products waiting for the warehouse's reprint — by live code — and how many wait.
	ReprintWaits(ctx context.Context, warehouseID uint64, offset, limit int) (ReprintWaitPage, error)
	// ReprintWaitingCount is how many products wait for the warehouse's reprint (*Cetak ulang kode (N)*).
	ReprintWaitingCount(ctx context.Context, warehouseID uint64) (int64, error)
	// RecordReprint is the warehouse's recorded print, on the caller's transaction: its waits cleared for the products
	// printed with their LIVE code, the tag off a product no warehouse waits for any more.
	RecordReprint(ctx context.Context, tx *gorm.DB, warehouseID uint64, printed []ReprintPrinted) (ReprintRecorded, error)
	// ReprintArrivals is a transfer accepted into the warehouse, on the accept's transaction: each received product some
	// warehouse still waits for now waits for this one too (its units wear the old stickers).
	ReprintArrivals(ctx context.Context, tx *gorm.DB, warehouseID uint64, productIDs []uint64) error
}

// ReprintWait is a product waiting for a warehouse's reprint, as product_service names it: its LIVE code, its name and
// its former code (empty when none).
type ReprintWait struct {
	ProductID   uint64
	ProductCode string
	Name        string
	FormerCode  string
}

// ReprintWaitPage is one page of ReprintWaits and how many products wait in all.
type ReprintWaitPage struct {
	Waits []ReprintWait
	Total int64
}

// ReprintPrinted is one product of a recorded print, with the code its labels carried.
type ReprintPrinted struct {
	ProductID   uint64
	ProductCode string
}

// ReprintRecorded is what a recorded print did — cleared here, not cleared because the code changed again, tag off.
type ReprintRecorded struct {
	Cleared     []uint64
	CodeChanged []uint64
	Untagged    []uint64
}

// ProductSearch is one search among a known set of products. Q empty = every product of the set. TagIDs keeps those
// carrying ANY of the product tags (the warehouse's Products list's Tag filter); WithTags asks each match's tags
// (products-have-their-own-tag-list: every warehouse holding a product sees them) — the Stock screen's, not the picker's.
type ProductSearch struct {
	ProductIDs []uint64
	Q          string
	TagIDs     []uint64
	WithTags   bool
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
	// Its product tags, the system's first, then by name — product_service's, as it named them; only when the search
	// asked WithTags.
	Tags []*productv1.ProductTag
}

// errNoProductSearch is a nil ProductReader's answer to a search: it knows no names to search.
var errNoProductSearch = errors.New("no product service to search")

// errNoProductReprints is a nil ProductReader's answer to the reprint: it knows no waits.
var errNoProductReprints = errors.New("no product service to ask which products wait for a reprint")

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

// ReprintWaits refuses, as Search does: with no product_service an empty list would read as "nothing waits here".
func (factsUnchecked) ReprintWaits(context.Context, uint64, int, int) (ReprintWaitPage, error) {
	return ReprintWaitPage{}, errNoProductReprints
}

func (factsUnchecked) ReprintWaitingCount(context.Context, uint64) (int64, error) {
	return 0, errNoProductReprints
}

func (factsUnchecked) RecordReprint(context.Context, *gorm.DB, uint64, []ReprintPrinted) (ReprintRecorded, error) {
	return ReprintRecorded{}, errNoProductReprints
}

// ReprintArrivals has nothing to tell: with no product_service no product was ever recomposed, so none waits — a test
// receiving a transfer needs no product service.
func (factsUnchecked) ReprintArrivals(context.Context, *gorm.DB, uint64, []uint64) error {
	return nil
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
