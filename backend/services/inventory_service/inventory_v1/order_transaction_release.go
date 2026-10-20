package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var errOrderTransactionMissing = errors.New("order transaction not found")

// OrderTransactionRelease releases an order's take by its key K — one path for an order cancelled and for a create
// that failed after its take (every-release-goes-by-the-key, the-key-is-claimed-in-its-own-table):
//
//   - K claimed with a transaction → that transaction is rolled back, once (an-undo-rolls-the-transaction-back-once);
//   - K claimed with none → nothing;
//   - K not claimed yet → claimed with none, so a take that arrives late meets the unique index and is refused.
//
// Another team's transaction reads NotFound: the key alone never lets one team release another's order.
func (s *Service) OrderTransactionRelease(
	ctx context.Context,
	req *connect.Request[inventoryv1.OrderTransactionReleaseRequest],
) (*connect.Response[inventoryv1.OrderTransactionReleaseResponse], error) {
	key := req.Msg.GetIdempotencyKey()
	teamID := req.Msg.GetTeamId()
	actor := actorFrom(ctx)

	res := &inventoryv1.OrderTransactionReleaseResponse{}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var claim inventory_service_models.IdempotencyOrderCheck

		found := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("idempotency_key = ?", key).Limit(1).Find(&claim)
		if found.Error != nil {
			return found.Error
		}

		if found.RowsAffected == 0 {
			// Nothing taken under K yet: claim it with none, so a late take is refused. A take committing in the same
			// instant wins the index instead — then there is a transaction to roll back after all.
			insertErr := tx.Exec(`INSERT INTO idempotency_order_check (idempotency_key) VALUES (?)
				ON CONFLICT (idempotency_key) DO NOTHING`, key).Error
			if insertErr != nil {
				return insertErr
			}

			found = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("idempotency_key = ?", key).Limit(1).Find(&claim)
			if found.Error != nil {
				return found.Error
			}
		}

		if claim.TransactionID == nil {
			return nil
		}

		var t inventory_service_models.InventoryTransaction

		loadErr := tx.Where("id = ? AND team_id = ?", *claim.TransactionID, teamID).Limit(1).Find(&t)
		if loadErr.Error != nil {
			return loadErr.Error
		}

		if loadErr.RowsAffected == 0 {
			return errOrderTransactionMissing
		}

		released, rollbackErr := inventory_mutations.RollbackTake(tx, t.ID, actor)
		if rollbackErr != nil {
			return rollbackErr
		}

		res.TransactionId = t.ID
		res.Released = released

		return nil
	})
	if err != nil {
		if errors.Is(err, errOrderTransactionMissing) {
			return nil, connect.NewError(connect.CodeNotFound, errOrderTransactionMissing)
		}

		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("release order transaction: %w", err))
	}

	return connect.NewResponse(res), nil
}
