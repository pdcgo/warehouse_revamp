package inventory_v1

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StoreProduct is one row of a supplier's Produk tab: a store of the supplier (0 = bought with no store) and a product.
type StoreProduct struct {
	StoreID   uint64
	ProductID uint64
}

// StoreProductGoods is what one supplier's goods of one product, bought at one store, did all time: SupplierGoods'
// figures for that store and product (the-detail-tabs-show-sold-and-ready).
type StoreProductGoods struct {
	StoreProduct

	// Units sold, a cancel counted back; the orders still netting below 0, and the newest take row of one.
	Sold      int64
	Orders    int64
	LastOrder *time.Time
	// Units on a shelf now.
	Ready int64
}

// SupplierStoreProductGoods answers the Produk tab's Terjual and Siap for the rows of ONE PAGE — a plain function over
// inventory's tables, called in-process by the composition root for supplier_service (cmd/app_development/
// supplier_goods_reader.go), as SupplierIDsAtWarehouse is. One statement per page, whatever its size: never a read per row.
//
// The figures are SupplierGoods' (supplier_goods.go), keyed by (store, product) instead of the supplier, store or
// warehouse: the batches minted with the supplier's id AND the store's (0 = a line naming the supplier alone) AND the
// product — every team's (every-selling-team-sees-every-teams-figures), a transfer-in carrying both ids counted where it
// went. `sold` nets each order transaction's rows (a cancel's flipped rows bring it to 0), `orders` counts the
// transactions still below 0, `ready` sums stock_count. Counts and dates only — never a price or a cost.
//
// A pair none of whose batches exists — every unit broke on the way — is absent.
//
// `warehouseID` is a supplier page's Gudang terkait chip (a-supplier-page-is-scoped-by-its-warehouses): every figure then
// counts only the batches in that warehouse — the row's goods THERE. 0 = every warehouse.
func SupplierStoreProductGoods(
	ctx context.Context,
	db *gorm.DB,
	supplierID uint64,
	warehouseID uint64,
	pairs []StoreProduct,
) ([]StoreProductGoods, error) {
	if supplierID == 0 || len(pairs) == 0 {
		return nil, nil
	}

	stores := make([]string, 0, len(pairs))
	products := make([]string, 0, len(pairs))

	for _, pair := range pairs {
		stores = append(stores, strconv.FormatUint(pair.StoreID, 10))
		products = append(products, strconv.FormatUint(pair.ProductID, 10))
	}

	storeArray := "{" + strings.Join(stores, ",") + "}"
	productArray := "{" + strings.Join(products, ",") + "}"

	// The chip, as one more predicate inside the per-pair lookup — the SQL stays one statement either way.
	inWarehouse := ""
	args := []any{storeArray, productArray, supplierID}

	if warehouseID > 0 {
		inWarehouse = " AND b.warehouse_id = ?"
		args = append(args, warehouseID)
	}

	args = append(args, string(inventory_service_models.TxOrder))

	var scans []struct {
		StoreID   uint64
		ProductID uint64
		Ready     int64
		Sold      int64
		Orders    int64
		LastOrder *time.Time
	}

	// The page's batches first, looked up PAIR BY PAIR through batches_supplier_idx (supplier, store) — the LATERAL's
	// OFFSET 0 keeps it a lookup per pair, never a hash of the whole supplier's batches — and MATERIALIZED, read once for
	// both figures; then the order rows of exactly those batches, through batch_logs' (batch_id, id) index one batch at a
	// time (SupplierGoods' sold). Ready and sold meet in ONE aggregate over a UNION ALL, never a join of the two: the
	// planner reads the materialized page as one row, and a join of two such aggregates became a nested loop re-reading
	// the sold side once per row — quadratic in the page (200 pairs 78 ms, against 48 ms now).
	err := db.
		WithContext(ctx).
		Raw(`
			WITH pairs AS (
				SELECT * FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS p(store_id, product_id)
			),
			page_batches AS MATERIALIZED (
				SELECT b.id, p.store_id, p.product_id, b.stock_count
				FROM pairs p
				CROSS JOIN LATERAL (
					SELECT b.id, b.stock_count
					FROM batches b
					WHERE b.supplier_id = ? AND b.product_id = p.product_id AND b.supplier_channel_id = p.store_id`+inWarehouse+`
					OFFSET 0
				) b
			),
			per_order AS (
				SELECT pb.store_id, pb.product_id, l.transaction_id,
				       SUM(l.change_count) AS net,
				       MAX(l.created_at) FILTER (WHERE l.change_count < 0) AS taken_at
				FROM page_batches pb
				CROSS JOIN LATERAL (
					SELECT transaction_id, change_count, created_at
					FROM batch_logs
					WHERE batch_id = pb.id AND change_type = ?
					OFFSET 0
				) l
				GROUP BY pb.store_id, pb.product_id, l.transaction_id
			),
			parts AS (
				SELECT store_id, product_id, GREATEST(stock_count, 0) AS ready,
				       0::bigint AS sold, 0::bigint AS orders, NULL::timestamptz AS last_order
				FROM page_batches
				UNION ALL
				SELECT store_id, product_id, 0, -net, CASE WHEN net < 0 THEN 1 ELSE 0 END,
				       CASE WHEN net < 0 THEN taken_at END
				FROM per_order
			)
			SELECT store_id, product_id,
			       SUM(ready) AS ready, SUM(sold) AS sold, SUM(orders) AS orders, MAX(last_order) AS last_order
			FROM parts
			GROUP BY store_id, product_id
			ORDER BY store_id, product_id`,
			args...,
		).
		Scan(&scans).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier %d goods per store and product: %w", supplierID, err)
	}

	out := make([]StoreProductGoods, 0, len(scans))
	for _, sc := range scans {
		out = append(out, StoreProductGoods{
			StoreProduct: StoreProduct{StoreID: sc.StoreID, ProductID: sc.ProductID},
			Sold:         sc.Sold,
			Orders:       sc.Orders,
			LastOrder:    sc.LastOrder,
			Ready:        sc.Ready,
		})
	}

	return out, nil
}
