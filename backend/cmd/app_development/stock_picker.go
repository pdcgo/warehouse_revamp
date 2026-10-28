package main

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// stockPicker joins selling_service to inventory_service (#149/#70): an order takes stock out of a
// warehouse, and a cancelled order gives it back.
//
// IT LIVES IN THE COMPOSITION ROOT ON PURPOSE. This is the one place that is allowed to know about
// two services at once — wiring them together is its entire job. selling_service declares the
// `StockPicker` interface it needs in its own terms and imports nothing from inventory; inventory
// knows nothing of orders. The dependency between them is this file, and it is deleteable: if the two
// ever run as separate processes, only this adapter changes into a Connect client over the network,
// and neither service notices.
//
// It calls the handler DIRECTLY rather than over HTTP, which is worth being explicit about because it
// skips the access interceptor. That is sound here, not a shortcut:
//
//   - The caller was already authorized. OrderCreate/OrderCancel ran their own policy against the
//     SELLING team before reaching this, and OrderTransactionCreate/Release are scoped to that same team — so
//     the check this path skips is the one that just ran.
//   - There is no per-warehouse permission to enforce (owner, 2026-07-20): any team may draw from any
//     warehouse, so no authorization decision is being bypassed, only re-executed.
//   - The RPCs stay in the contract and stay policed, so an EXTERNAL caller is fully checked. This
//     path is an in-process shortcut past a check it has already passed, not a hole in it.
type stockPicker struct {
	inventory *inventory_v1.Service
}

// NewStockPicker provides the selling side's StockPicker. Returning the INTERFACE rather than the
// struct is what keeps Wire honest — selling_v1.NewService asks for a StockPicker, and this is the
// only thing that satisfies it.
func NewStockPicker(inventory *inventory_v1.Service) selling_v1.StockPicker {
	return &stockPicker{inventory: inventory}
}

func (p *stockPicker) Pick(
	ctx context.Context,
	sellingTeamID, warehouseID uint64,
	lines []selling_v1.PickLine,
	ref string,
) (selling_v1.PickDraw, error) {
	out := make([]*inventoryv1.OrderTransactionLine, 0, len(lines))
	for _, line := range lines {
		out = append(out, &inventoryv1.OrderTransactionLine{
			ProductId: line.ProductID,
			Quantity:  line.Quantity,
		})
	}

	// THE ORDER'S REF IS ITS KEY until the order form mints one per submit (the-order-take-bridges-its-key-per-order):
	// `order:<order id>` takes once, and the cancel releases by the same key.
	res, err := p.inventory.OrderTransactionCreate(ctx, connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId:         sellingTeamID,
		IdempotencyKey: ref,
		WarehouseId:    warehouseID,
		Lines:          out,
	}))
	if err != nil {
		return nil, err
	}

	// WHAT EACH LINE DREW, as the take priced it: the cost of the units that left the shelf — the owner's batches oldest
	// first (an-order-is-costed-at-what-leaves-the-shelf) — and the total, that cost plus the product's own markup on a
	// borrowed line (inventory-computes-the-markup) — with the unit price after the markup and the markup itself, the
	// owner's `unit_cost_with_markup` and `markup_total`. Carried over untouched: the order freezes what inventory
	// returned. The cost is total − markup_total, which on an own line is the take's value exactly.
	draw := make(selling_v1.PickDraw, len(res.Msg.GetItems()))
	for _, item := range res.Msg.GetItems() {
		draw[item.GetProductId()] = selling_v1.PickedLine{
			Cost:               item.GetTotal() - item.GetMarkupTotal(),
			UnitCost:           item.GetUnitCost(),
			Total:              item.GetTotal(),
			UnitCostWithMarkup: item.GetUnitCostWithMarkup(),
			MarkupTotal:        item.GetMarkupTotal(),
		}
	}

	return draw, nil
}

func (p *stockPicker) Return(
	ctx context.Context,
	sellingTeamID, _ uint64,
	ref string,
) error {
	// A release of a key that never took answers released = false, never an error — an order that drew no stock
	// cancels cleanly. The warehouse is the take's own; the key finds it.
	_, err := p.inventory.OrderTransactionRelease(ctx, connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId:         sellingTeamID,
		IdempotencyKey: ref,
	}))

	return err
}
