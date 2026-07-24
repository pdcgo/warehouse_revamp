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
//     SELLING team before reaching this, and StockPick/StockReturn are scoped to that same team — so
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
) error {
	out := make([]*inventoryv1.StockPickLine, 0, len(lines))
	for _, line := range lines {
		out = append(out, &inventoryv1.StockPickLine{
			ProductId: line.ProductID,
			Quantity:  line.Quantity,
		})
	}

	_, err := p.inventory.StockPick(ctx, connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId:      sellingTeamID,
		WarehouseId: warehouseID,
		Lines:       out,
		Ref:         ref,
	}))

	return err
}

func (p *stockPicker) Return(
	ctx context.Context,
	sellingTeamID, warehouseID uint64,
	ref string,
) error {
	_, err := p.inventory.StockReturn(ctx, connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId:      sellingTeamID,
		WarehouseId: warehouseID,
		Ref:         ref,
	}))

	return err
}

func (p *stockPicker) UnitCosts(
	ctx context.Context,
	sellingTeamID, warehouseID uint64,
	productIDs []uint64,
) (map[uint64]int64, error) {
	res, err := p.inventory.StockCost(ctx, connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId:      sellingTeamID,
		WarehouseId: warehouseID,
		ProductIds:  productIDs,
	}))
	if err != nil {
		return nil, err
	}

	// Only products with a KNOWN cost come back, so the map is naturally missing the rest — which is
	// the distinction the caller needs (#74).
	costs := make(map[uint64]int64, len(res.Msg.GetCosts()))
	for _, c := range res.Msg.GetCosts() {
		costs[c.GetProductId()] = c.GetUnitCost()
	}

	return costs, nil
}
