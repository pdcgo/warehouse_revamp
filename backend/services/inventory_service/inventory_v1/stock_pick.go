package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockPick takes stock out of a warehouse for an order (#69/#149) — the selling side's draw.
//
// Scoped to the SELLING team, not the warehouse. Any team may draw from any warehouse (owner's call),
// so there is no per-warehouse permission to check, and there could not usefully be one: nobody in a
// selling team holds a role inside a warehouse. See the contract for why it must stay scoped to
// something rather than being unscoped.
//
// WHICH SHELF IT COMES OFF (owner, 2026-07-20): the unplaced pile first, then shelves by label, until
// the line is filled. At placement nobody has physically walked to a rack, so the drain ORDER is
// arbitrary — but the RECORD is not: a movement is written per place drawn, naming the shelf, so a
// picker later reads what actually happened rather than a guess. When §1 says how picking really works
// (#71), the physical order can replace this one without changing what was recorded.
//
// The whole draw is ONE transaction. A partly-applied pick would leave an order holding stock that was
// taken from some lines and not others — worse than refusing, because nothing would say so.
func (s *Service) StockPick(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockPickRequest],
) (*connect.Response[inventoryv1.StockPickResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	actor := actorFrom(ctx)

	var movements []*inventory_service_models.StockMovement

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, line := range req.Msg.GetLines() {
			taken, err := pickOneLine(tx, warehouseID, line.GetProductId(), line.GetQuantity(),
				req.Msg.GetRef(), actor)
			if err != nil {
				return err
			}

			movements = append(movements, taken...)
		}

		return nil
	})
	if err != nil {
		return nil, writeError(err)
	}

	out := make([]*inventoryv1.StockMovement, 0, len(movements))
	for i := range movements {
		out = append(out, movementToProto(movements[i]))
	}

	return connect.NewResponse(&inventoryv1.StockPickResponse{Movements: out}), nil
}

// pickOneLine draws `quantity` of one product out of a warehouse, spreading the draw across its places
// in the documented order: unplaced first, then shelves by label.
//
// It returns the movements it wrote — one per place drawn, so a line satisfied from two shelves yields
// two. That is what makes the drain auditable rather than merely correct.
func pickOneLine(
	tx *gorm.DB,
	warehouseID, productID uint64,
	quantity int64,
	ref string,
	actor uint64,
) ([]*inventory_service_models.StockMovement, error) {
	// The places holding this product, in drain order, LOCKED so a concurrent pick cannot read the same
	// rows and both decide there is enough.
	//
	// `(rack_id IS NOT NULL)` sorts FALSE first, which is the unplaced pile — goods that arrived and
	// were never shelved should leave before shelved stock is disturbed. Then `r.code`, the label
	// painted on the shelf, because that is the order a person walking the aisles would meet them in.
	//
	// FOR UPDATE OF sl: the join to racks is only for the label, and locking the rack row too would
	// block anyone renaming a shelf while an order is being placed.
	type place struct {
		RackID *uint64
		OnHand int64
	}

	var places []place

	err := tx.Raw(`
		SELECT sl.rack_id AS rack_id, sl.on_hand AS on_hand
		FROM stock_levels sl
		LEFT JOIN racks r ON r.id = sl.rack_id
		WHERE sl.warehouse_id = ? AND sl.product_id = ? AND sl.on_hand > 0
		ORDER BY (sl.rack_id IS NOT NULL), r.code
		FOR UPDATE OF sl`,
		warehouseID, productID,
	).Scan(&places).Error
	if err != nil {
		return nil, err
	}

	var (
		out       []*inventory_service_models.StockMovement
		remaining = quantity
	)

	for i := range places {
		if remaining == 0 {
			break
		}

		take := places[i].OnHand
		if take > remaining {
			take = remaining
		}

		balance, applyErr := applyDelta(tx, warehouseID, productID, places[i].RackID, -take)
		if applyErr != nil {
			return nil, applyErr
		}

		mv, moveErr := appendMovement(tx, warehouseID, productID, places[i].RackID, -take, balance,
			inventoryv1.MovementKind_MOVEMENT_KIND_PICK, "order", ref, actor)
		if moveErr != nil {
			return nil, moveErr
		}

		out = append(out, mv)
		remaining -= take
	}

	// Not enough across ALL of this warehouse's places. Reported as the same insufficient-stock error a
	// single-place over-draw gives, because it is the same fact from the caller's side: the warehouse
	// cannot fill this line. The transaction rolls back, so the places drained so far are restored —
	// an order must never take part of what it asked for.
	if remaining > 0 {
		return nil, errInsufficientStock
	}

	return out, nil
}
