// Package inventory_v1 implements warehouse.inventory.v1.InventoryService — on-hand stock and the
// movement ledger behind it.
//
// The model is ledger + derived snapshot: `stock_movements` is the append-only truth, `stock_levels`
// is a cache of the running on-hand maintained INSIDE each movement's transaction. Every RPC is
// scoped by warehouse_id (use_scope); product_id is an opaque product_service id.
package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ inventoryv1connect.InventoryServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// errInsufficientStock is returned when a movement would drive on-hand below zero.
var errInsufficientStock = errors.New("insufficient stock for this movement")

// writeError maps an over-draw to FailedPrecondition — a client error, "you cannot move out more
// than is there" — and everything else to Internal. The CHECK on_hand >= 0 is a backstop.
func writeError(err error) error {
	if errors.Is(err, errInsufficientStock) || errors.Is(err, gorm.ErrCheckConstraintViolated) {
		return connect.NewError(connect.CodeFailedPrecondition, errInsufficientStock)
	}

	return connect.NewError(connect.CodeInternal, err)
}

// actorFrom pulls the acting user's id from the request identity (0 if somehow absent — the ledger
// records who, but a missing actor must not fail a movement).
func actorFrom(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

// applyDelta applies a SIGNED delta to the (warehouse, product) on-hand snapshot and returns the new
// on-hand. Two steps, both race-safe:
//
//  1. ensure a level row exists (0 if new) — a non-negative INSERT the CHECK is happy with;
//  2. an UPDATE guarded by `on_hand + delta >= 0`, which locks the row and refuses an over-draw.
//     Zero rows updated means the guard blocked it → insufficient stock.
//
// A plain additive `ON CONFLICT DO UPDATE` cannot be used: Postgres evaluates the CHECK on the
// TENTATIVE insert row (here the negative delta) before it resolves the conflict, so it would reject
// a valid decrement of an existing level.
func applyDelta(tx *gorm.DB, warehouseID, productID uint64, delta int64) (int64, error) {
	err := tx.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, on_hand, updated_at)
		VALUES (?, ?, 0, NOW())
		ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
		warehouseID, productID,
	).Error
	if err != nil {
		return 0, err
	}

	var onHand int64

	res := tx.Raw(`
		UPDATE stock_levels SET on_hand = on_hand + ?, updated_at = NOW()
		WHERE warehouse_id = ? AND product_id = ? AND on_hand + ? >= 0
		RETURNING on_hand`,
		delta, warehouseID, productID, delta,
	).Scan(&onHand)
	if res.Error != nil {
		return 0, res.Error
	}

	if res.RowsAffected == 0 {
		return 0, errInsufficientStock
	}

	return onHand, nil
}

// appendMovement writes one ledger row. Append-only — this is the only way a movement is recorded.
func appendMovement(
	tx *gorm.DB,
	warehouseID, productID uint64,
	delta, balance int64,
	kind inventoryv1.MovementKind,
	reason, ref string,
	actor uint64,
) (*inventory_service_models.StockMovement, error) {
	mv := inventory_service_models.StockMovement{
		WarehouseID: warehouseID,
		ProductID:   productID,
		Delta:       delta,
		Balance:     balance,
		Kind:        int32(kind),
		Reason:      reason,
		Ref:         ref,
		ActorUserID: actor,
	}

	err := tx.Create(&mv).Error
	if err != nil {
		return nil, err
	}

	return &mv, nil
}

// recordSingle is the common path for a one-sided movement (receive): apply the delta and append the
// ledger row in one transaction.
func (s *Service) recordSingle(
	ctx context.Context,
	warehouseID, productID uint64,
	delta int64,
	kind inventoryv1.MovementKind,
	reason, ref string,
) (*inventory_service_models.StockMovement, error) {
	actor := actorFrom(ctx)

	var mv *inventory_service_models.StockMovement

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		balance, err := applyDelta(tx, warehouseID, productID, delta)
		if err != nil {
			return err
		}

		mv, err = appendMovement(tx, warehouseID, productID, delta, balance, kind, reason, ref, actor)

		return err
	})
	if err != nil {
		return nil, err
	}

	return mv, nil
}

func levelToProto(l *inventory_service_models.StockLevel) *inventoryv1.StockLevel {
	return &inventoryv1.StockLevel{
		ProductId:   l.ProductID,
		WarehouseId: l.WarehouseID,
		OnHand:      l.OnHand,
	}
}

func movementToProto(m *inventory_service_models.StockMovement) *inventoryv1.StockMovement {
	return &inventoryv1.StockMovement{
		Id:          m.ID,
		ProductId:   m.ProductID,
		WarehouseId: m.WarehouseID,
		Delta:       m.Delta,
		Balance:     m.Balance,
		Kind:        inventoryv1.MovementKind(m.Kind),
		Reason:      m.Reason,
		Ref:         m.Ref,
		ActorUserId: m.ActorUserID,
		CreatedAt:   m.CreatedAt.UTC().Format(time.RFC3339),
	}
}
