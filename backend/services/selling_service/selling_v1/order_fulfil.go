package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The warehouse's side of an order (#150): CONFIRMED → PICKING → PACKED → SHIPPED.
//
// Forward only, ONE STEP AT A TIME. You cannot pack what was never picked, and a skipped state means
// somebody is guessing at what happened — so each move states the state it must find, and refuses
// anything else with FailedPrecondition.
var errWrongStateForStep = errors.New("the order is not in the state this step follows")

// loadWarehouseOrder loads one order FOR UPDATE, constrained to the WAREHOUSE that ships it.
//
// This is the counterpart of loadScopedOrder, which constrains by the SELLING team — and the
// difference is the whole point of #150. The crew holds no role in the team that placed the order, so
// a selling-scoped load would deny every real caller. Here the warehouse_id clause IS the scope check:
// another warehouse's order reads as NotFound, never PermissionDenied, so a crew cannot even discover
// that an order id belongs to someone else's building.
func loadWarehouseOrder(
	tx *gorm.DB,
	warehouseID, orderID uint64,
	dst *selling_service_models.Order,
) error {
	return tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		Where("id = ? AND warehouse_id = ?", orderID, warehouseID).
		First(dst).
		Error
}

// advance is the shared body of the three fulfilment steps: load the order for this warehouse, insist
// it is in exactly the state this step follows, and move it on.
//
// The row is locked and the state re-checked INSIDE the transaction, so two crew members hitting the
// same button at once cannot both see "confirmed" and both advance it — the loser finds the state
// already moved and is refused.
func (s *Service) advance(
	ctx context.Context,
	warehouseID, orderID uint64,
	from, to string,
) (*selling_service_models.Order, error) {
	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadWarehouseOrder(tx, warehouseID, orderID, &order)
		if loadErr != nil {
			return loadErr
		}

		if order.Status != from {
			return errWrongStateForStep
		}

		return setOrderStatus(tx, &order, to)
	})
	if err != nil {
		return nil, mapOrderErr(err)
	}

	return &order, nil
}

// OrderPick — the crew has started collecting this order. CONFIRMED → PICKING.
//
// Picking does NOT move stock: it was already deducted when the order was placed (#149). This records
// that a person is collecting what the system already committed, which is why there is no inventory
// call here and must not be one — a second deduction would take the goods twice.
func (s *Service) OrderPick(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderPickRequest],
) (*connect.Response[sellingv1.OrderPickResponse], error) {
	order, err := s.advance(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(),
		orderStatusConfirmed, orderStatusPicking)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.OrderPickResponse{Order: orderToProto(order)}), nil
}

// OrderPack — collected and boxed. PICKING → PACKED.
func (s *Service) OrderPack(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderPackRequest],
) (*connect.Response[sellingv1.OrderPackResponse], error) {
	order, err := s.advance(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(),
		orderStatusPicking, orderStatusPacked)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.OrderPackResponse{Order: orderToProto(order)}), nil
}

// OrderShip — handed to the courier. PACKED → SHIPPED, and the last thing the warehouse does with it.
//
// After this the goods have LEFT THE BUILDING, which is what makes SHIPPED the point where a cancel
// stops being possible (#70/#150): putting the stock back would book goods onto a shelf while they are
// on a courier's van. What comes back after this is a RETURN — a different event, with different
// money — and calling it a cancel would hide that.
func (s *Service) OrderShip(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderShipRequest],
) (*connect.Response[sellingv1.OrderShipResponse], error) {
	order, err := s.advance(ctx, req.Msg.GetTeamId(), req.Msg.GetOrderId(),
		orderStatusPacked, orderStatusShipped)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.OrderShipResponse{Order: orderToProto(order)}), nil
}
