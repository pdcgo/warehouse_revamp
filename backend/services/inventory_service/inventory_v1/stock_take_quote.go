package inventory_v1

import (
	"context"
	"fmt"
	"sort"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
)

// StockTakeQuote answers what an order's take WOULD draw, before it draws it — the order form's per-line cost
// (an-order-is-costed-at-what-leaves-the-shelf). Every money figure of an order is the cost of the units that leave the
// shelf, so the form previews the very draw OrderTransactionCreate will make, and the order freezes the one it made.
//
// It is the take's own path, read-only, in the take's order:
//
//  1. Each product once — a product listed twice is refused, as the take refuses it.
//  2. The products read from product_service, as the take reads them: whose batches each line draws, and whether this
//     team may draw them at all. A line the take would refuse as not allowed is answered with nothing available
//     (notAllowedLines — the take's own rule, not a copy of it).
//  3. inventory_mutations.QuoteOrder — PostOrder without the lock or the writes: the owner's batches oldest first, the
//     same selection (inventory_ledgers.DrawOldestFirst).
//
// A short line is REPORTED, not refused: `enough` false and no cost, because the take would draw nothing for it — and
// a cost nobody can answer is absent, never 0 ("unknown" is not "free").
//
// The answer is COST only. A borrowed product's markup is the form's to apply for its invoice, from the product's own
// rate, exactly as the take applies it (inventory-computes-the-markup).
func (s *Service) StockTakeQuote(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockTakeQuoteRequest],
) (*connect.Response[inventoryv1.StockTakeQuoteResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()

	ids := make([]uint64, 0, len(msg.GetLines()))
	asked := make([]*inventoryv1.OrderTransactionLine, 0, len(msg.GetLines()))
	seen := make(map[uint64]struct{}, len(msg.GetLines()))

	for _, line := range msg.GetLines() {
		if _, dup := seen[line.GetProductId()]; dup {
			return nil, connect.NewError(connect.CodeInvalidArgument, errOrderLineTwice)
		}

		seen[line.GetProductId()] = struct{}{}
		ids = append(ids, line.GetProductId())
		asked = append(asked, &inventoryv1.OrderTransactionLine{ProductId: line.GetProductId(), Quantity: line.GetQuantity()})
	}

	// THE PRODUCTS, as the take reads them — before any read of the ledger, a call to another service.
	facts, err := s.products.Facts(ctx, teamID, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ask product facts: %w", err))
	}

	notAllowed, err := s.notAllowedLines(ctx, teamID, asked, facts)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	refused := make(map[uint64]bool, len(notAllowed))
	for _, line := range notAllowed {
		refused[line.GetProductId()] = true
	}

	order := inventory_mutations.Order{WarehouseID: msg.GetWarehouseId(), TeamID: teamID}
	items := make([]*inventoryv1.StockTakeQuoteItem, 0, len(asked))

	for _, line := range asked {
		if refused[line.GetProductId()] {
			// The take would refuse it whatever the shelf holds: nothing it could draw, and so no cost.
			items = append(items, &inventoryv1.StockTakeQuoteItem{
				ProductId:   line.GetProductId(),
				OwnerTeamId: facts[line.GetProductId()].TeamID,
				Quantity:    line.GetQuantity(),
			})

			continue
		}

		order.Lines = append(order.Lines, inventory_mutations.OrderLine{
			ProductID:   line.GetProductId(),
			OwnerTeamID: facts[line.GetProductId()].TeamID,
			Quantity:    line.GetQuantity(),
		})
	}

	quoted, err := inventory_mutations.QuoteOrder(s.db.WithContext(ctx), order)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	for _, q := range quoted {
		items = append(items, quotedItem(q))
	}

	sort.Slice(items, func(i, j int) bool { return items[i].GetProductId() < items[j].GetProductId() })

	return connect.NewResponse(&inventoryv1.StockTakeQuoteResponse{Items: items}), nil
}

// quotedItem is one line as the take would price it: the value its batches would give up, per unit and in all — the
// same arithmetic pricedTake answers the real take with — and each batch's share, oldest first.
func quotedItem(q inventory_mutations.QuotedLine) *inventoryv1.StockTakeQuoteItem {
	item := &inventoryv1.StockTakeQuoteItem{
		ProductId:   q.ProductID,
		OwnerTeamId: q.OwnerTeamID,
		Quantity:    q.Quantity,
		Available:   q.Available,
		Enough:      q.Available >= q.Quantity,
	}

	if !item.GetEnough() {
		return item
	}

	_, value := inventory_ledgers.TotalTaken(q.Batches)
	unitCost := value / float64(q.Quantity)

	item.TotalCost = &value
	item.UnitCost = &unitCost

	for _, b := range q.Batches {
		item.Batches = append(item.Batches, &inventoryv1.StockTakeQuoteBatch{
			Quantity: b.Count,
			UnitCost: b.Valuation / float64(b.Count),
			Total:    b.Valuation,
		})
	}

	return item
}
