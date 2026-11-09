package main

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// stockPicker joins selling_service to inventory_service (#149/#70): an order takes stock out of a
// warehouse, a create that failed after its take gives it back directly, and a cancel first asks whether a stock count
// holds it (the cancelled order's stock itself goes back on OrderCancelled, inventory-returns-stock-on-order-cancelled).
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
	key string,
) (selling_v1.Take, error) {
	out := make([]*inventoryv1.OrderTransactionLine, 0, len(lines))
	for _, line := range lines {
		out = append(out, &inventoryv1.OrderTransactionLine{
			ProductId: line.ProductID,
			Quantity:  line.Quantity,
		})
	}

	// THE ORDER'S OWN KEY K, passed through as sent (backlog #10 slice 3, the-frontend-mints-the-idempotency-key): the
	// take runs before the order row exists, so it is filed under K and the release finds it by K
	// (every-release-goes-by-the-key).
	res, err := p.inventory.OrderTransactionCreate(ctx, connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId:         sellingTeamID,
		IdempotencyKey: key,
		WarehouseId:    warehouseID,
		Lines:          out,
	}))
	if err != nil {
		return selling_v1.Take{}, err
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

	// The inventory transaction the take wrote — the order stores it (the-placement-page-reads-racks-by-transaction-id).
	return selling_v1.Take{TransactionID: res.Msg.GetTransactionId(), Draw: draw}, nil
}

func (p *stockPicker) Return(
	ctx context.Context,
	sellingTeamID, _ uint64,
	key string,
) error {
	// A release of a key that never took answers released = false, never an error — an order that drew no stock
	// cancels cleanly. The warehouse is the take's own; the key finds it.
	_, err := p.inventory.OrderTransactionRelease(ctx, connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId:         sellingTeamID,
		IdempotencyKey: key,
	}))

	return err
}

// StockLockCheck asks inventory, in process, whether a stock count holds a rack the take under `key` came from — a read
// of inventory's own tables (a-cancel-still-meets-the-count-first). The answer is carried over in selling's terms: the
// count's session and the warehouse's own sentence naming it, the same words the release refuses with.
func (p *stockPicker) StockLockCheck(
	ctx context.Context,
	sellingTeamID, warehouseID uint64,
	key string,
) (*selling_v1.StockLock, error) {
	counted, err := p.inventory.StockLockCheck(ctx, sellingTeamID, warehouseID, key)
	if err != nil {
		return nil, err
	}

	if counted == nil {
		return nil, nil
	}

	return &selling_v1.StockLock{SessionID: counted.SessionID, Reason: counted.Error()}, nil
}

// ReturnStock puts an accepted return back on the return warehouse's shelves through inventory's OrderTransactionReturn,
// in process (return_decision.md). Called by the order's return accept before it moves the order, under the WAREHOUSE's
// scope the accept already passed — the same policy OrderTransactionReturn declares — so the check this path skips is
// the one that just ran. A refusal comes back as inventory's own Connect error, unchanged.
func (p *stockPicker) ReturnStock(ctx context.Context, in selling_v1.StockReturn) (selling_v1.ReturnedStock, error) {
	lines := make([]*inventoryv1.OrderTransactionReturnLine, 0, len(in.Lines))
	for _, line := range in.Lines {
		placements := make([]*inventoryv1.OrderTransactionReturnPlacement, 0, len(line.Placements))
		for _, p := range line.Placements {
			placements = append(placements, &inventoryv1.OrderTransactionReturnPlacement{
				PlacementId: p.RackID,
				Quantity:    p.Quantity,
			})
		}

		lines = append(lines, &inventoryv1.OrderTransactionReturnLine{
			ProductId:       line.ProductID,
			ReturnProductId: line.ReturnProductID,
			MarkupRate:      line.MarkupRate,
			Sound:           line.Sound,
			Broken:          line.Broken,
			Missing:         line.Missing,
			Note:            line.Note,
			Placements:      placements,
		})
	}

	res, err := p.inventory.OrderTransactionReturn(ctx, connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId:            in.ReturnWarehouseID,
		SellingTeamId:     in.SellingTeamID,
		TakeTransactionId: in.TakeTransactionID,
		Lines:             lines,
		Description:       in.Description,
	}))
	if err != nil {
		return selling_v1.ReturnedStock{}, err
	}

	out := selling_v1.ReturnedStock{TransactionID: res.Msg.GetTransactionId(), Posted: res.Msg.GetPosted()}
	for _, problem := range res.Msg.GetProblems() {
		out.Problems = append(out.Problems, selling_v1.ReturnedProblem{
			ProductID: problem.GetProductId(),
			Broken:    problem.GetType() == inventoryv1.OrderTransactionReturnProblemType_ORDER_TRANSACTION_RETURN_PROBLEM_TYPE_BROKEN,
			Count:     problem.GetCount(),
			Note:      problem.GetNote(),
		})
	}

	return out, nil
}
