package inventory_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierGoods answers what a supplier's goods did, all time: the units sold and on how many orders, the units ready,
// how many restocks brought them and when the last order and the last restock were — per supplier, per store or per
// warehouse (the-supplier-list-shows-sales-and-ready-stock, sales-are-all-time-with-their-last-dates,
// the-detail-tabs-show-sold-and-ready, the-summary-is-sold-and-ready-with-their-counts).
//
// ── Whose goods ─────────────────────────────────────────────────────────────────────────────────
//
// A supplier's goods are the batches minted with its id — a restock line copies it onto its batch at accept, and a
// transfer copies it onto the batch it mints (a-batch-keeps-its-supplier). So a product bought from two suppliers
// splits by batch, and a unit counts for the supplier it was bought from. EVERY team's batches count: a supplier's
// figures are not private to the team that bought (every-selling-team-sees-every-teams-figures), so the caller's
// team_id authorizes and never narrows.
//
// ── What each figure is ─────────────────────────────────────────────────────────────────────────
//
//	sold    -Σ change_count of the batches' ORDER rows. A cancel rolls the take back with flipped rows of the same
//	        type (a-rollback-reverses-its-log-rows), so a cancelled order nets to 0 — it never left the shelf.
//	orders  the order transactions whose rows on them still net below 0 — a rolled-back take nets to 0; the newest
//	        take row of one is the last order.
//	ready   Σ stock_count of the batches — OwnerStockByIds' ready.
//	restock the distinct RESTOCK transactions that minted them; the newest batch is the last restock. A transfer-in
//	        mints a batch with the supplier too, and is not a restock.
//
// Three aggregates keyed by (supplier, group key), merged here — each a plain GROUP BY over the supplier's batches
// (`batches_supplier_idx`).
func (s *Service) SupplierGoods(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierGoodsRequest],
) (*connect.Response[inventoryv1.SupplierGoodsResponse], error) {
	key, err := supplierGoodsKey(req.Msg.GetGroup())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	ids := req.Msg.GetSupplierIds()
	db := s.db.WithContext(ctx)
	rows := supplierGoodsRows{group: req.Msg.GetGroup()}

	err = rows.ready(db, key, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	err = rows.restocks(db, key, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	err = rows.sold(db, key, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&inventoryv1.SupplierGoodsResponse{Rows: rows.list}), nil
}

// supplierGoodsKey is the batch column a group keys by — a constant per group, never caller text, so it is safe to
// splice into the SELECT.
func supplierGoodsKey(group inventoryv1.SupplierGoodsGroup) (string, error) {
	switch group {
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER:
		return "0", nil
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE:
		return "b.supplier_channel_id", nil
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE:
		return "b.warehouse_id", nil
	}

	return "", fmt.Errorf("unknown group %v", group)
}

type supplierGoodsKeyOf struct {
	supplierID uint64
	key        uint64
}

// supplierGoodsRows collects the rows in first-touch order; a key seen by any of the three aggregates gets one row.
type supplierGoodsRows struct {
	group inventoryv1.SupplierGoodsGroup
	byKey map[supplierGoodsKeyOf]*inventoryv1.SupplierGoods
	list  []*inventoryv1.SupplierGoods
}

func (r *supplierGoodsRows) at(supplierID, key uint64) *inventoryv1.SupplierGoods {
	if r.byKey == nil {
		r.byKey = map[supplierGoodsKeyOf]*inventoryv1.SupplierGoods{}
	}

	k := supplierGoodsKeyOf{supplierID: supplierID, key: key}
	row, ok := r.byKey[k]
	if ok {
		return row
	}

	row = &inventoryv1.SupplierGoods{SupplierId: supplierID}
	switch r.group {
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE:
		row.StoreId = key
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE:
		row.WarehouseId = key
	}

	r.byKey[k] = row
	r.list = append(r.list, row)

	return row
}

func unixOf(t *time.Time) int64 {
	if t == nil {
		return 0
	}

	return t.Unix()
}

// ready — what is on a shelf now.
func (r *supplierGoodsRows) ready(db *gorm.DB, key string, ids []uint64) error {
	var scans []struct {
		SupplierID uint64
		K          uint64
		Ready      int64
	}

	err := db.
		Table(inventory_service_models.Batch{}.TableName()+" AS b").
		Select("b.supplier_id, "+key+" AS k, SUM(b.stock_count) AS ready").
		Where("b.supplier_id IN ?", ids).
		Where("b.stock_count > 0").
		Group("b.supplier_id, k").
		Order("b.supplier_id, k").
		Scan(&scans).
		Error
	if err != nil {
		return fmt.Errorf("supplier goods ready: %w", err)
	}

	for _, sc := range scans {
		r.at(sc.SupplierID, sc.K).ReadyUnits = sc.Ready
	}

	return nil
}

// restocks — the accepted restocks that minted the supplier's batches, and the newest.
func (r *supplierGoodsRows) restocks(db *gorm.DB, key string, ids []uint64) error {
	var scans []struct {
		SupplierID  uint64
		K           uint64
		Restocks    int64
		LastRestock *time.Time
	}

	err := db.
		Table(inventory_service_models.Batch{}.TableName()+" AS b").
		Select("b.supplier_id, "+key+" AS k, COUNT(DISTINCT b.transaction_id) AS restocks, MAX(b.created_at) AS last_restock").
		Joins("JOIN inventory_transactions t ON t.id = b.transaction_id").
		Where("b.supplier_id IN ?", ids).
		Where("t.tx_type = ?", string(inventory_service_models.TxRestock)).
		Group("b.supplier_id, k").
		Order("b.supplier_id, k").
		Scan(&scans).
		Error
	if err != nil {
		return fmt.Errorf("supplier goods restocks: %w", err)
	}

	for _, sc := range scans {
		row := r.at(sc.SupplierID, sc.K)
		row.Restocks = sc.Restocks
		row.LastRestockUnix = unixOf(sc.LastRestock)
	}

	return nil
}

// sold — the order rows of the supplier's batches. A cancel rolls its take back with flipped rows, so per transaction
// the rows net to 0: an order is a transaction whose rows still net below 0, and the last order the newest take row
// of one. Netting per transaction needs no join to inventory_transactions, and the LATERAL reads batch_logs through
// its (batch_id, id) index one batch at a time — a plain join (or a LATERAL the planner pulls up) hashed the whole of
// batch_logs; the OFFSET 0 keeps it a per-batch lookup.
func (r *supplierGoodsRows) sold(db *gorm.DB, key string, ids []uint64) error {
	var scans []struct {
		SupplierID uint64
		K          uint64
		Sold       int64
		Orders     int64
		LastOrder  *time.Time
	}

	err := db.
		Raw(`
			SELECT supplier_id, k,
			       -SUM(net) AS sold,
			       COUNT(*) FILTER (WHERE net < 0) AS orders,
			       MAX(taken_at) FILTER (WHERE net < 0) AS last_order
			FROM (
				SELECT b.supplier_id, `+key+` AS k, l.transaction_id,
				       SUM(l.change_count) AS net,
				       MAX(l.created_at) FILTER (WHERE l.change_count < 0) AS taken_at
				FROM batches b
				CROSS JOIN LATERAL (
					SELECT transaction_id, change_count, created_at
					FROM batch_logs
					WHERE batch_id = b.id AND change_type = ?
					OFFSET 0
				) l
				WHERE b.supplier_id IN ?
				GROUP BY b.supplier_id, k, l.transaction_id
			) per_order
			GROUP BY supplier_id, k
			ORDER BY supplier_id, k`, string(inventory_service_models.TxOrder), ids).
		Scan(&scans).
		Error
	if err != nil {
		return fmt.Errorf("supplier goods sold: %w", err)
	}

	for _, sc := range scans {
		row := r.at(sc.SupplierID, sc.K)
		row.SoldUnits = sc.Sold
		row.Orders = sc.Orders
		row.LastOrderUnix = unixOf(sc.LastOrder)
	}

	return nil
}
