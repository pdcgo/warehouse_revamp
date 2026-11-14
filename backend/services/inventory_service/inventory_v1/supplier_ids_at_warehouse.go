package inventory_v1

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierIDsAtWarehouse answers the supplier list's and Discover's Gudang filter (the-warehouse-filters-before-the-team,
// the-warehouse-filter-narrows-only-the-rows): the suppliers whose goods were received at one warehouse, in id order —
// EXACTLY the suppliers whose page lists that warehouse among its Gudang terkait chips, so a filter and the chips never
// disagree.
//
// The chips are SupplierGoods grouped by WAREHOUSE, which has a row for a warehouse wherever any of its three aggregates
// touches one of the supplier's batches there. So a supplier is at W when one of its batches in W
//
//	holds units now          stock_count > 0 — whatever minted it: a restock, a transfer-in, a return
//	was minted by a restock  its minting transaction is a `restock` — emptied since or not
//	was ever sold from       it has an `order` row in batch_logs — even one a cancel netted back to 0
//
// A batch's supplier is the restock LINE's (a-batch-keeps-its-supplier: copied from the line at accept, from the source
// batch by a transfer), never the restock's own; batches from nobody (supplier 0) are left out. EVERY team's batches
// count (every-selling-team-sees-every-teams-figures) — the caller narrows to its own suppliers with its own team
// predicate. A batch that came by a transfer and left again unsold, or was written off to 0, made no chip and makes no
// match.
//
// The restock test is a SCALAR subquery on purpose: it is always a primary-key lookup per batch, run only for a batch
// the shelf test did not already keep. Written as EXISTS, the planner hashed every restock transaction of every
// warehouse first — a read that grows with the whole company's history, not with this warehouse's batches
// (cmd/app_development/supplier_list_warehouse_perf_test.go).
//
// A plain function over inventory's own tables (HARD RULE 3), asked through the composition root's seam
// (cmd/app_development/supplier_goods_reader.go).
func SupplierIDsAtWarehouse(ctx context.Context, db *gorm.DB, warehouseID uint64) ([]uint64, error) {
	var ids []uint64

	err := db.
		WithContext(ctx).
		Raw(`
			SELECT DISTINCT b.supplier_id
			FROM batches b
			WHERE b.warehouse_id = ?
			  AND b.supplier_id > 0
			  AND (
			        b.stock_count > 0
			     OR (SELECT t.tx_type FROM inventory_transactions t WHERE t.id = b.transaction_id) = ?
			     OR EXISTS (SELECT 1 FROM batch_logs l WHERE l.batch_id = b.id AND l.change_type = ?)
			  )
			ORDER BY b.supplier_id`,
			warehouseID,
			string(inventory_service_models.TxRestock),
			string(inventory_service_models.TxOrder),
		).
		Scan(&ids).
		Error
	if err != nil {
		return nil, fmt.Errorf("suppliers at warehouse %d: %w", warehouseID, err)
	}

	return ids, nil
}
