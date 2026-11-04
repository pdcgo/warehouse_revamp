package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockLockCheck answers whether a stock count holds a rack the take filed under key K came from — the count that would
// refuse that take's release right now — or nil when none does (a-cancel-still-meets-the-count-first).
//
// AN IN-PROCESS READ, not an RPC: the order's cancel asks it FIRST, before the order's status moves, so a cancel a count
// would block is refused as it always was — naming the count — and the order stays pending. The release itself no longer
// runs inside the cancel: inventory makes it on OrderCancelled (inventory-returns-stock-on-order-cancelled), and a cancel
// that slips past this check (a count starting in the same instant) has that release error and redeliver until the count
// ends. So this is a courtesy to the person, never the lock: the lock is the release's own (ReversePlacementLogs).
//
// It reads inventory's own tables only, takes no lock and writes nothing:
//
//   - K never claimed, claimed with no transaction, or claimed by another team's take → nil (nothing of this team's
//     to hold back; the release on the event acknowledges those);
//   - the take already rolled back → nil (nothing left to put back);
//   - otherwise the count over the take's rack rows, the first in (product, rack) order — the same one the release
//     would be refused with, so the two name the same count.
//
// The warehouse is the order's, given as a guard: a take that is not in it is not this order's and holds nothing back.
func (s *Service) StockLockCheck(
	ctx context.Context,
	teamID, warehouseID uint64,
	key string,
) (*inventory_ledgers.CountedError, error) {
	if key == "" {
		return nil, nil
	}

	db := s.db.WithContext(ctx)

	var take struct {
		ID          uint64
		WarehouseID uint64
		IsRollback  bool
	}

	found := db.
		Table(inventory_service_models.IdempotencyOrderCheck{}.TableName()+" AS c").
		Select("t.id, t.warehouse_id, t.is_rollback").
		Joins("JOIN "+inventory_service_models.InventoryTransaction{}.TableName()+" AS t ON t.id = c.transaction_id").
		Where("c.idempotency_key = ? AND t.team_id = ?", key, teamID).
		Limit(1).
		Scan(&take)
	if found.Error != nil {
		return nil, fmt.Errorf("read the take under key %q: %w", key, found.Error)
	}

	if found.RowsAffected == 0 || take.IsRollback || (warehouseID != 0 && take.WarehouseID != warehouseID) {
		return nil, nil
	}

	var keys []inventory_ledgers.RackKey

	err := db.
		Model(&inventory_service_models.ProductPlacementLog{}).
		Distinct("product_id", "placement_id").
		Where("transaction_id = ?", take.ID).
		Scan(&keys).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the rack rows of take %d: %w", take.ID, err)
	}

	// The release's own refusal, read the same way: the first lock in (product, rack) order, so both name one count.
	err = inventory_ledgers.RefuseCounted(db, keys)
	if err == nil {
		return nil, nil
	}

	var counted *inventory_ledgers.CountedError
	if errors.As(err, &counted) {
		return counted, nil
	}

	return nil, err
}
