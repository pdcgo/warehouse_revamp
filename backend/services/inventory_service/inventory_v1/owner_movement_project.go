package inventory_v1

import (
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// projectOwnerMovement writes one ledger row into the CATALOGUE OWNER's lens (#232), in the same
// transaction as the movement itself — so the two can never disagree about what happened.
//
// It runs from appendMovement, the single choke point every ledger row goes through. Later this
// becomes an event consumer (owner) and this call goes away; the rows it writes, and the read that
// serves them, stay exactly as they are.
//
// ── Ownership is resolved HERE, once ────────────────────────────────────────────────────────────
//
// Not at read time. The climb is three tables (batch → restock line → the team that raised it) and
// the alternative is paying for it on every page turn of every product. Resolving it at write time
// also pins the answer to the moment the stock moved, which is what a ledger row is.
//
// ── Two rules, because a recount cannot climb ───────────────────────────────────────────────────
//
// A batch-borne event names its batch and the chain answers directly. A shelf RECOUNT names none — it
// reconciles the whole shelf — so it belongs to whoever owns stock of that product in that building.
// Both are joins over what the database already knows; neither trusts a caller.
//
// A movement that resolves to NO owner writes nothing, and that is correct: stock nobody restocked
// here has no owner to tell. The INSERT is a SELECT for exactly that reason — zero rows in, zero out.
func projectOwnerMovement(tx *gorm.DB, mv *inventory_service_models.StockMovement) error {
	// A shelf-to-shelf MOVE changes where a building's stock sits, not what the owner holds. Skipping
	// it is also what keeps the read's running balance honest: projecting one leg and not the other
	// would corrupt every figure after it, and projecting both would add a pair of zeros to the story.
	if inventoryv1.MovementKind(mv.Kind) == inventoryv1.MovementKind_MOVEMENT_KIND_MOVE {
		return nil
	}

	const cols = `
		INSERT INTO stock_owner_movements
			(movement_id, owner_team_id, warehouse_id, product_id, batch_id, kind, delta, reason, ref,
			 actor_user_id, created_at)`

	if mv.BatchID != nil {
		return tx.Exec(cols+`
			SELECT ?, r.requesting_team_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
			FROM stock_batches b
			JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
			JOIN restock_requests r ON r.id = ri.restock_request_id
			WHERE b.id = ?
			ON CONFLICT (movement_id, owner_team_id) DO NOTHING`,
			mv.ID, mv.WarehouseID, mv.ProductID, mv.BatchID, mv.Kind, mv.Delta, mv.Reason, mv.Ref,
			mv.ActorUserID, mv.CreatedAt, *mv.BatchID,
		).Error
	}

	// DISTINCT because a product's units in one building may have arrived on many restocks — all the
	// same team's in practice, but the query does not need that to be true to be correct.
	return tx.Exec(cols+`
		SELECT ?, o.owner_team_id, ?, ?, NULL, ?, ?, ?, ?, ?, ?
		FROM (
			SELECT DISTINCT r.requesting_team_id AS owner_team_id
			FROM stock_batches b
			JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
			JOIN restock_requests r ON r.id = ri.restock_request_id
			WHERE b.product_id = ? AND b.warehouse_id = ?
		) o
		ON CONFLICT (movement_id, owner_team_id) DO NOTHING`,
		mv.ID, mv.WarehouseID, mv.ProductID, mv.Kind, mv.Delta, mv.Reason, mv.Ref,
		mv.ActorUserID, mv.CreatedAt, mv.ProductID, mv.WarehouseID,
	).Error
}
