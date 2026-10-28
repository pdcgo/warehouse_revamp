package inventory_v1

import (
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// AN OWN LINE'S MARKUP IS EXACTLY 0, and a borrowed line's is never negative — selling freezes `markup_total` behind a
// CHECK >= 0 (selling 00025). Priced as (value ÷ qty) × qty − value, a draw of 1 rupiah over 49 units came out a hair
// under zero (1 ÷ 49 × 49 is 0.999…), which would have refused the order at its insert. The take prices the markup on
// the draw's value instead, so the own line's figures are the draw exactly.
func TestPricedTake_AnOwnLinesMarkupIsExactlyZero(t *testing.T) {
	const ordering uint64 = 2

	taken := []inventory_mutations.TakenLine{
		{ProductID: 1, OwnerTeamID: ordering, Quantity: 49, Value: 1},
		{ProductID: 2, OwnerTeamID: 9, Quantity: 49, Value: 1},
	}
	facts := map[uint64]ProductFact{2: {TeamID: 9, CrossMarkupBps: 0}}

	res := pricedTake(inventory_service_models.InventoryTransaction{}, taken, ordering, facts)

	for _, item := range res.GetItems() {
		if item.GetMarkupTotal() != 0 || item.GetTotal() != 1 {
			t.Fatalf("line %v — want markup exactly 0 and total exactly the draw's 1", item)
		}
	}
}

// A borrowed line: the markup is the draw's value at the owner's rate, the total the value plus it, and one unit at
// the markup the total over the quantity.
func TestPricedTake_ABorrowedLineIsPricedOnTheDraw(t *testing.T) {
	const ordering uint64 = 2

	taken := []inventory_mutations.TakenLine{{ProductID: 7, OwnerTeamID: 9, Quantity: 3, Value: 34_000}}
	facts := map[uint64]ProductFact{7: {TeamID: 9, CrossMarkupBps: 2_000}}

	item := pricedTake(inventory_service_models.InventoryTransaction{}, taken, ordering, facts).GetItems()[0]

	if item.GetMarkupTotal() != 6_800 || item.GetTotal() != 40_800 || item.GetUnitCostWithMarkup() != 13_600 {
		t.Fatalf("line %v — want markup 6800, total 40800, 13600 a unit", item)
	}
}
