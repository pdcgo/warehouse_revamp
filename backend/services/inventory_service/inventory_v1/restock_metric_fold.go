package inventory_v1

import (
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RESTOCK BEFORE THE ACCEPT on Analytic's Restock (docs/business/analytic/rpc_provide_decision.md —
// the-restock-before-the-accept-prototype-is-accepted, a-cancelled-restock-takes-its-ordered-back-on-its-day,
// a-lost-box-that-turns-up-takes-its-lost-back-on-its-day). Each restock write notes what it moved on the transaction's
// stock report (inventory_ledgers.NoteRestockFacts), and the report writes it as the transaction's LAST statement — the
// door report row the accept already writes, keyed by the restock's warehouse and team and the line's product and
// supplier, on the transaction's Jakarta day:
//
//	create        + ordered, every line
//	edit          − ordered as it was, + ordered as it is (lines added / changed / removed, the shipping, the
//	              warehouse — a warehouse change leaves the old warehouse and reaches the new one that day); ongoing and
//	              arrived alike, the difference on the edit day (an-expense-correction-counts-on-the-day-it-is-made)
//	cancel        − ordered, every line
//	mark lost     + lost on the way, every line as ordered then
//	sign (lost →) − lost on the way — the box turned up (a-late-lost-box-is-signed-for-as-arrived)
//	accept        + the courier's COD, Terima's final figure (the-courier-charge-is-noted-at-tiba-and-final-at-terima)
//
// A line's VALUE is its share of the restock's total — the goods it was raised for plus the shipping its team paid,
// never the courier's COD (the-couriers-charge-stays-out-of-total) — the shipping spread over the units ORDERED as the
// landed price spreads it (inventory_mutations.LandedPrice, all-qty-is-every-unit-ordered); the COD is spread the same
// way. So the lines of one restock add up to its total, and a product's or supplier's row is its lines' share
// (the-headline-is-the-sum-of-its-rows).

// restockFigure is which pair of a restock's figures a write moves.
type restockFigure int

const (
	restockOrdered restockFigure = iota
	restockLost
)

// restockShareFacts is the restock's lines as `figure`, signed: each line's units and its share of the total — its own
// goods plus the shipping over the units ordered — under the restock's warehouse and team as they are on `rr`.
func restockShareFacts(
	rr *inventory_service_models.Restock,
	items []inventory_service_models.RestockItem,
	figure restockFigure,
	sign int64,
) []inventory_ledgers.RestockFact {
	allQty := restockUnits(items)
	facts := make([]inventory_ledgers.RestockFact, 0, len(items))

	for i := range items {
		item := items[i]

		value := item.Total
		if allQty > 0 {
			value += rr.ShipmentCost * float64(item.Count) / float64(allQty)
		}

		fact := restockLineKey(rr, item)

		switch figure {
		case restockOrdered:
			fact.Ordered = sign * item.Count
			fact.OrderedValue = float64(sign) * value
		case restockLost:
			fact.Lost = sign * item.Count
			fact.LostValue = float64(sign) * value
		}

		facts = append(facts, fact)
	}

	return facts
}

// restockCODFacts is the courier's charge at the door spread over the lines by the units ordered, as the landed price
// spreads it — none when there is no charge.
func restockCODFacts(
	rr *inventory_service_models.Restock,
	items []inventory_service_models.RestockItem,
	cod float64,
) []inventory_ledgers.RestockFact {
	allQty := restockUnits(items)
	if cod <= 0 || allQty <= 0 {
		return nil
	}

	facts := make([]inventory_ledgers.RestockFact, 0, len(items))

	for i := range items {
		fact := restockLineKey(rr, items[i])
		fact.COD = cod * float64(items[i].Count) / float64(allQty)

		facts = append(facts, fact)
	}

	return facts
}

// restockLineKey is a line's door key — the accept's (restock_request_accept.go): the restock's warehouse and team, the
// line's product and supplier (0 = none).
func restockLineKey(rr *inventory_service_models.Restock, item inventory_service_models.RestockItem) inventory_ledgers.RestockFact {
	return inventory_ledgers.RestockFact{
		WarehouseID: rr.WarehouseID,
		TeamID:      rr.TeamID,
		ProductID:   item.ProductID,
		SupplierID:  derefID(item.SupplierID),
	}
}

// restockUnits is every unit the lines order (all-qty-is-every-unit-ordered).
func restockUnits(items []inventory_service_models.RestockItem) int64 {
	var units int64
	for i := range items {
		units += items[i].Count
	}

	return units
}
