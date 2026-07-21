package selling_v1

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderCreate records a new order (status PLACED) and its lines in one transaction. The shop must
// belong to the scoped team. It does NOT touch inventory — stock integration is #69.
func (s *Service) OrderCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCreateRequest],
) (*connect.Response[sellingv1.OrderCreateResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()

	// An order must say which warehouse fulfils it (#72). Proto validation requires it, but this
	// re-checks rather than trusting the zero value: unit tests bypass the validation interceptor, and
	// from #69 this id is what stock is deducted FROM — an order that reached the database saying
	// "warehouse 0" would be an order the system cannot honour, discovered only when someone tries to
	// ship it. 0 is reserved for rows that predate #72 and must never be written again.
	if req.Msg.GetWarehouseId() == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOrderNoWarehouse)
	}

	// The shop is checked BEFORE any stock moves. A bad shop is a rejected request, and rejecting it
	// after taking stock would mean compensating a draw that never needed to happen.
	shopOK, err := shopExists(s.db.WithContext(ctx), teamID, shopID)
	if err != nil {
		return nil, dbError(err)
	}

	if !shopOK {
		return nil, notFound()
	}

	// What the goods COST us, frozen onto the order (#74). Read before the transaction — it is a read,
	// and doing it inside would hold the order's row lock across another service's call for nothing.
	//
	// A product with no known cost is ABSENT from this map, which becomes a 0 on the line: "we do not
	// know what this cost". That is deliberately not the same as free, and the contract says so — a
	// margin computed over an unknown cost reads as pure profit, so 0 is a flag rather than a figure.
	costs, err := s.stock.UnitCosts(ctx, teamID, req.Msg.GetWarehouseId(), orderProductIDs(req.Msg.GetItems()))
	if err != nil {
		return nil, dbError(err)
	}

	var (
		order selling_service_models.Order
		// Whether the stock draw was ATTEMPTED. See the compensation block below for why "attempted"
		// rather than "succeeded" is the right thing to track.
		picked bool
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		address := req.Msg.GetAddress()

		order = selling_service_models.Order{
			TeamID: teamID,
			ShopID: shopID,
			// The warehouse this order ships from (#72), as chosen by whoever typed it — copied onto
			// the order, never looked up later, so it reads the same forever.
			WarehouseID:   req.Msg.GetWarehouseId(),
			Status:        orderStatusPlaced,
			CustomerName:  req.Msg.GetCustomerName(),
			CustomerPhone: req.Msg.GetCustomerPhone(),
			// FROZEN at order time: the names are copied, not resolved later, so this order reads the
			// same forever even after region_service renames or merges the desa (#118).
			ProvinsiCode:  address.GetProvinsiCode(),
			ProvinsiName:  address.GetProvinsiName(),
			KabupatenCode: address.GetKabupatenCode(),
			KabupatenName: address.GetKabupatenName(),
			KecamatanCode: address.GetKecamatanCode(),
			KecamatanName: address.GetKecamatanName(),
			DesaCode:      address.GetDesaCode(),
			DesaName:      address.GetDesaName(),
			KodePos:       address.GetKodePos(),
			AddressLine:   address.GetAddressLine(),
			ShippingCode:  req.Msg.GetShippingCode(),
			Subtotal:      req.Msg.GetSubtotal(),
			ShippingCost:  req.Msg.GetShippingCost(),
			Total:         req.Msg.GetTotal(),
			Items:         orderItemModels(req.Msg.GetItems()),
		}

		// Stamp each line's cost and total it onto the header (#74). Done here rather than in
		// orderItemModels because the cost comes from the WAREHOUSE, not from the request — a client
		// supplying it would be writing its own margin.
		for i := range order.Items {
			order.Items[i].UnitCost = costs[order.Items[i].ProductID]
			order.COGS += int64(order.Items[i].Quantity) * order.Items[i].UnitCost
		}

		// GORM inserts the order and its items in this transaction, stamping their OrderID.
		createErr := tx.Create(&order).Error
		if createErr != nil {
			return createErr
		}

		// THE STOCK, inside the order's still-uncommitted transaction (#149).
		//
		// The insert comes first only to get the order's id, which is what the pick is recorded
		// under — the ref is what a later cancel names to put exactly this draw back (#70). The
		// GUARANTEE is unchanged and is what the owner chose: the pick must succeed before the order
		// is committed, so not enough stock means this transaction rolls back and NO ORDER EXISTS.
		// Writing the order first and deducting afterwards would leave a gap in which two orders
		// could be placed against the same unit.
		picked = true

		return s.stock.Pick(ctx, teamID, order.WarehouseID, pickLines(req.Msg.GetItems()),
			stockRef(order.ID))
	})
	if err != nil {
		// COMPENSATION (#149). The pick runs against another service and commits on its own; if this
		// transaction then failed, stock has left for an order that does not exist. There is no
		// rollback that reaches across both, so the draw is UNDONE explicitly.
		//
		// `picked` is set before the call rather than after, deliberately: a Pick that fails midway
		// takes nothing (it is one transaction there), but a Pick whose result never reached us — a
		// timeout, a panic — may well have committed. Compensating a draw that never happened is a
		// harmless NotFound; failing to compensate one that did is stock lost from the building.
		if picked {
			returnErr := s.stock.Return(ctx, teamID, order.WarehouseID, stockRef(order.ID))
			if returnErr != nil {
				// The order failed AND its stock could not be put back. Say both, because the second
				// is the one someone has to fix by hand, and a message naming only the first would
				// send them looking in the wrong place.
				return nil, connect.NewError(connect.CodeInternal,
					errors.New("the order failed and its stock could not be returned ("+
						stockRef(order.ID)+"): "+returnErr.Error()))
			}
		}

		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	// THE ORDER IS COMMITTED. Announce it (#153) so revenue can record what it was expected to make.
	//
	// After the commit, never inside it. Publishing inside would mean a rolled-back order that revenue
	// has already recorded — a phantom nothing would ever correct. The cost of doing it here is the
	// opposite failure: a crash between commit and publish leaves an order with no revenue row. That is
	// the better half of the trade, and only because it is REPAIRABLE — the order still holds every
	// figure the event carries, and RevenueRecord refuses duplicates on order_id, so a backfill can be
	// run safely at any time.
	//
	// A publish failure does NOT fail the order. Revenue is downstream: a shop must be able to keep
	// selling while the revenue service, or the broker, is down. It is logged loudly instead, because
	// the alternative — swallowing it — is how a month-end report quietly goes wrong.
	_, publishErr := s.events(ctx, &sellingv1.OrderPlacedEvent{
		TeamId:       order.TeamID,
		OrderId:      order.ID,
		Revenue:      order.Total,
		Cogs:         order.COGS,
		ShippingCost: order.ShippingCost,
		CostKnown:    costKnown(order.Items, costs),
	})
	if publishErr != nil {
		slog.ErrorContext(ctx, "order placed but OrderPlacedEvent was not published — "+
			"its revenue row must be backfilled",
			"order_id", order.ID,
			"team_id", order.TeamID,
			"error", publishErr,
		)
	}

	return connect.NewResponse(&sellingv1.OrderCreateResponse{Order: orderToProto(&order)}), nil
}

// costKnown reports whether EVERY line's cost was actually known (#74/#153).
//
// A product with no recorded cost is absent from the costs map and lands on its line as 0, which is
// indistinguishable from "free" once it is written down. So the distinction is computed here, while
// the map is still in hand, and travels with the event as its own field.
//
// ALL lines, not some. One unknown line understates the order's COGS, which overstates its margin —
// and a margin that is wrong is wrong however few lines caused it. A "mostly known" cost is not a
// thing a report can use.
func costKnown(items []selling_service_models.OrderItem, costs map[uint64]int64) bool {
	for i := range items {
		_, known := costs[items[i].ProductID]
		if !known {
			return false
		}
	}

	return true
}
