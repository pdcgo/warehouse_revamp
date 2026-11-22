//go:build perfaudit

// PROBE #116 (Statistics P0) — MEASURE ONLY, nothing here is production code. Option A of the statistics scoping:
// running sold totals per supplier × store × product × warehouse, written in the order take's and the rollback's own
// stock transaction, and the three reads rewritten onto them — SupplierGoods' sold (Terjual, *dari N transaksi*,
// *Pesanan terakhir*), SupplierStoreProductGoods (the Produk tab) and SupplierIDsByFigure's Terjual band.
//
//   - The table is a TEST table (probe116_supplier_goods_totals): created in the test transaction, or committed and
//     dropped again by the committed latency probe.
//   - Its WRITER rides the REAL take (OrderTransactionCreate → PostOrder) and the REAL rollback (releaseByKey →
//     RollbackTake) through three GORM callbacks: the stock transaction's `order` batch rows are noted as they are
//     inserted, the take's time as ReverseBatchLogs reads them back, and the totals are upserted right after the
//     transaction's own last statement (the inventory_stock_daily_changes upsert) — one more last-lock statement, as a
//     build would add it to StockReport.write. The probe joins the noted rows to `batches` by primary key; a build has
//     those batches in memory already (BatchWrites.changed), so the probe's write is an UPPER bound.
//   - The OLD queries are kept here VERBATIM (HEAD 887a2c8a) and every new read is compared with them.
//
// "orders" is counted per ORDER TRANSACTION at the screen's grain: an order taking two products of one supplier is ONE
// of its *transaksi*, not two. Counts per (supplier, store, product, warehouse) do not add up to that, so each row
// carries three counters — `orders` (this exact key), `orders_store` (counted once per order on the first product of
// its (supplier, store, warehouse)) and `orders_supplier` (once per order on the first (store, product) of its
// (supplier, warehouse)). A take draws in ONE warehouse, so the supplier's and the store's whole counts are those
// summed over warehouses.
//
//	go test -tags perfaudit -p 1 -timeout 20m -run 'TestProbe116|TestPerf_Probe116' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// ── The table ─────────────────────────────────────────────────────────────────────────────────────────────────────

const p116Table = "probe116_supplier_goods_totals"

const p116DDL = `
CREATE TABLE probe116_supplier_goods_totals (
    supplier_id     BIGINT      NOT NULL,
    store_id        BIGINT      NOT NULL,
    product_id      BIGINT      NOT NULL,
    warehouse_id    BIGINT      NOT NULL,
    sold_units      BIGINT      NOT NULL DEFAULT 0,
    orders          BIGINT      NOT NULL DEFAULT 0,
    orders_store    BIGINT      NOT NULL DEFAULT 0,
    orders_supplier BIGINT      NOT NULL DEFAULT 0,
    last_order_at   TIMESTAMPTZ,
    PRIMARY KEY (supplier_id, store_id, product_id, warehouse_id)
)`

func p116CreateTable(t testing.TB, db *gorm.DB, name string) {
	t.Helper()

	err := db.Exec(strings.Replace(p116DDL, p116Table, name, 1)).Error
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
}

// p116Backfill fills a totals table from the ledger, as a build's migration would (00042's shape): per order
// transaction and key its net, then per key — the same netting the old query does, so a fully rolled-back take adds
// nothing. `where` narrows the batches (empty = all).
func p116Backfill(t testing.TB, db *gorm.DB, table, where string) {
	t.Helper()

	if where != "" {
		where = " AND " + where
	}

	err := db.Exec(`
		WITH per_tx AS (
		    SELECT b.supplier_id, b.supplier_channel_id AS store_id, b.product_id, b.warehouse_id, l.transaction_id,
		           SUM(l.change_count) AS net,
		           MAX(l.created_at) FILTER (WHERE l.change_count < 0) AS taken_at
		    FROM batch_logs l
		    JOIN batches b ON b.id = l.batch_id
		    WHERE l.change_type = 'order' AND b.supplier_id <> 0` + where + `
		    GROUP BY 1, 2, 3, 4, 5
		), marked AS (
		    SELECT per_tx.*,
		           ROW_NUMBER() OVER (PARTITION BY transaction_id, supplier_id, store_id, warehouse_id ORDER BY product_id) AS in_store,
		           ROW_NUMBER() OVER (PARTITION BY transaction_id, supplier_id, warehouse_id ORDER BY store_id, product_id) AS in_supplier
		    FROM per_tx
		)
		INSERT INTO ` + table + ` (supplier_id, store_id, product_id, warehouse_id, sold_units, orders, orders_store,
		                         orders_supplier, last_order_at)
		SELECT supplier_id, store_id, product_id, warehouse_id,
		       -SUM(net),
		       COUNT(*) FILTER (WHERE net < 0),
		       COUNT(*) FILTER (WHERE net < 0 AND in_store = 1),
		       COUNT(*) FILTER (WHERE net < 0 AND in_supplier = 1),
		       MAX(taken_at) FILTER (WHERE net < 0)
		FROM marked
		GROUP BY 1, 2, 3, 4`).Error
	if err != nil {
		t.Fatalf("backfill %s: %v", table, err)
	}
}

// ── The writer, hooked into the real take and rollback ───────────────────────────────────────────────────────────

var (
	p116On   atomic.Bool
	p116Once sync.Once
	p116Mu   sync.Mutex
	// One entry per open stock transaction, keyed by its report (shared by a nested StockTransaction).
	p116Pending = map[*inventory_ledgers.StockReport]*p116Tx{}

	p116Upserts      atomic.Int64 // totals upserts written (one per take or rollback)
	p116Fallbacks    atomic.Int64 // rollbacks whose take was some key's last order — the fallback statement ran
	p116FallbackKeys atomic.Int64 // keys the fallback re-read
)

type p116Tx struct {
	rows    []inventory_service_models.BatchLog
	takenAt map[uint64]time.Time
}

func p116StateOf(db *gorm.DB) *p116Tx {
	report := inventory_ledgers.ReportOf(db)
	if report == nil {
		return nil
	}

	st := p116Pending[report]
	if st == nil {
		st = &p116Tx{takenAt: map[uint64]time.Time{}}
		p116Pending[report] = st
	}

	return st
}

// p116Install registers the three callbacks once per test binary; p116On switches them.
func p116Install(t testing.TB, db *gorm.DB) {
	t.Helper()

	var err error

	p116Once.Do(func() {
		cb := db.Callback()

		err = cb.Create().After("gorm:create").Register("probe116:note_order_rows", p116NoteRows)
		if err != nil {
			return
		}

		err = cb.Query().After("gorm:query").Register("probe116:note_take_time", p116NoteTakeTime)
		if err != nil {
			return
		}

		err = cb.Raw().After("gorm:raw").Register("probe116:write_totals", p116WriteTotals)
	})
	if err != nil {
		t.Fatalf("install the probe's writer: %v", err)
	}
}

func p116Logs(dest any) []inventory_service_models.BatchLog {
	switch d := dest.(type) {
	case []inventory_service_models.BatchLog:
		return d
	case *[]inventory_service_models.BatchLog:
		return *d
	}

	return nil
}

// p116NoteRows: BatchWrites.Flush inserted log rows — note the `order` ones on the transaction's entry.
func p116NoteRows(db *gorm.DB) {
	if !p116On.Load() || db.Error != nil {
		return
	}

	logs := p116Logs(db.Statement.Dest)
	if len(logs) == 0 {
		return
	}

	p116Mu.Lock()
	defer p116Mu.Unlock()

	st := p116StateOf(db)
	if st == nil {
		return
	}

	for _, l := range logs {
		if l.ChangeType == string(inventory_service_models.TxOrder) {
			st.rows = append(st.rows, l)
		}
	}
}

// p116NoteTakeTime: ReverseBatchLogs read a take's rows back — note the take's time (a build has those rows in memory).
func p116NoteTakeTime(db *gorm.DB) {
	if !p116On.Load() || db.Error != nil {
		return
	}

	logs := p116Logs(db.Statement.Dest)
	if len(logs) == 0 {
		return
	}

	p116Mu.Lock()
	defer p116Mu.Unlock()

	st := p116StateOf(db)
	if st == nil {
		return
	}

	for _, l := range logs {
		if l.ChangeType != string(inventory_service_models.TxOrder) || l.ChangeCount >= 0 {
			continue
		}

		if at, ok := st.takenAt[l.TransactionID]; !ok || l.CreatedAt.After(at) {
			st.takenAt[l.TransactionID] = l.CreatedAt
		}
	}
}

// p116WriteTotals: right after the stock transaction's own last statement, upsert its totals.
func p116WriteTotals(db *gorm.DB) {
	if !p116On.Load() || db.Error != nil {
		return
	}

	if !strings.Contains(db.Statement.SQL.String(), "INSERT INTO inventory_stock_daily_changes") {
		return
	}

	report := inventory_ledgers.ReportOf(db)
	if report == nil {
		return
	}

	p116Mu.Lock()
	st := p116Pending[report]
	delete(p116Pending, report)
	p116Mu.Unlock()

	if st == nil || len(st.rows) == 0 {
		return
	}

	err := p116Write(db.Session(&gorm.Session{NewDB: true}), st)
	if err != nil {
		db.AddError(err)
	}
}

// p116Upsert is the take's and the rollback's ONE statement: the transaction's `order` rows summed per key (a take's
// rows are all negative, its rollback's all positive), the order counted (+1 a take, −1 its rollback) on the key and on
// the first key of its store and of its supplier in the warehouse, the last order raised to the take's time. Written in
// key order, so two transactions take shared rows in one order.
const p116Upsert = `
WITH v AS (
    SELECT * FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS v(batch_id, change_count)
), fine AS (
    SELECT b.supplier_id, b.supplier_channel_id AS store_id, b.product_id, b.warehouse_id, SUM(v.change_count) AS cnt
    FROM v
    JOIN batches b ON b.id = v.batch_id
    WHERE b.supplier_id <> 0
    GROUP BY 1, 2, 3, 4
), marked AS (
    SELECT fine.*,
           ROW_NUMBER() OVER (PARTITION BY supplier_id, store_id, warehouse_id ORDER BY product_id) AS in_store,
           ROW_NUMBER() OVER (PARTITION BY supplier_id, warehouse_id ORDER BY store_id, product_id) AS in_supplier
    FROM fine
)
INSERT INTO probe116_supplier_goods_totals AS t
    (supplier_id, store_id, product_id, warehouse_id, sold_units, orders, orders_store, orders_supplier, last_order_at)
SELECT supplier_id, store_id, product_id, warehouse_id, -cnt, CAST(? AS bigint),
       CASE WHEN in_store = 1 THEN CAST(? AS bigint) ELSE 0 END,
       CASE WHEN in_supplier = 1 THEN CAST(? AS bigint) ELSE 0 END,
       CAST(? AS timestamptz)
FROM marked
ORDER BY supplier_id, store_id, product_id, warehouse_id
ON CONFLICT (supplier_id, store_id, product_id, warehouse_id) DO UPDATE SET
    sold_units      = t.sold_units + EXCLUDED.sold_units,
    orders          = t.orders + EXCLUDED.orders,
    orders_store    = t.orders_store + EXCLUDED.orders_store,
    orders_supplier = t.orders_supplier + EXCLUDED.orders_supplier,
    last_order_at   = GREATEST(t.last_order_at, EXCLUDED.last_order_at)
RETURNING supplier_id, store_id, product_id, warehouse_id, last_order_at`

// p116LastStanding is *Pesanan terakhir* of ONE key re-read from the ledger with the old query's own netting: the newest
// take row of an order transaction still netting below 0. `%s` is the key's predicate on `b`.
const p116LastStanding = `
SELECT MAX(x.taken_at)
FROM (
    SELECT l.transaction_id,
           SUM(l.change_count) AS net,
           MAX(l.created_at) FILTER (WHERE l.change_count < 0) AS taken_at
    FROM batches b
    CROSS JOIN LATERAL (
        SELECT transaction_id, change_count, created_at
        FROM batch_logs
        WHERE batch_id = b.id AND change_type = 'order'
        OFFSET 0
    ) l
    WHERE %s
    GROUP BY l.transaction_id
) x
WHERE x.net < 0`

// p116Fallback runs only for the keys whose last order WAS the rolled-back take — its own statement, after the upsert
// holds the rows' locks, so (READ COMMITTED) it reads every take committed before it got them.
var p116Fallback = `
UPDATE probe116_supplier_goods_totals AS t
SET last_order_at = (` + fmt.Sprintf(p116LastStanding, `b.supplier_id = t.supplier_id AND b.supplier_channel_id = t.store_id
          AND b.product_id = t.product_id AND b.warehouse_id = t.warehouse_id`) + `)
FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[]), CAST(? AS bigint[]), CAST(? AS bigint[]))
     AS k(supplier_id, store_id, product_id, warehouse_id)
WHERE t.supplier_id = k.supplier_id AND t.store_id = k.store_id AND t.product_id = k.product_id
  AND t.warehouse_id = k.warehouse_id`

type p116Key struct {
	SupplierID  uint64
	StoreID     uint64
	ProductID   uint64
	WarehouseID uint64
	LastOrderAt *time.Time
}

func p116Array(values []uint64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatUint(v, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

func p116SignedArray(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatInt(v, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

func p116Write(tx *gorm.DB, st *p116Tx) error {
	byTx := map[uint64][]inventory_service_models.BatchLog{}
	for _, r := range st.rows {
		byTx[r.TransactionID] = append(byTx[r.TransactionID], r)
	}

	ids := make([]uint64, 0, len(byTx))
	for id := range byTx {
		ids = append(ids, id)
	}

	slices.Sort(ids)

	for _, id := range ids {
		rows := byTx[id]
		rollback := rows[0].ChangeCount > 0

		batches := make([]uint64, 0, len(rows))
		counts := make([]int64, 0, len(rows))

		var takenAt time.Time

		for _, r := range rows {
			if (r.ChangeCount > 0) != rollback {
				return fmt.Errorf("probe116: transaction %d mixes take and rollback rows", id)
			}

			batches = append(batches, r.BatchID)
			counts = append(counts, r.ChangeCount)

			if r.CreatedAt.After(takenAt) {
				takenAt = r.CreatedAt
			}
		}

		sign := int64(1)

		var raised any = takenAt

		if rollback {
			sign = -1
			raised = nil
		}

		var back []p116Key

		err := tx.
			Raw(p116Upsert, p116Array(batches), p116SignedArray(counts), sign, sign, sign, raised).
			Scan(&back).
			Error
		if err != nil {
			return fmt.Errorf("probe116 totals upsert of transaction %d: %w", id, err)
		}

		p116Upserts.Add(1)

		if !rollback {
			continue
		}

		taken, ok := st.takenAt[id]
		if !ok {
			return fmt.Errorf("probe116: rollback of transaction %d without its take's time", id)
		}

		var sup, sto, pro, wh []uint64

		for _, k := range back {
			if k.LastOrderAt != nil && k.LastOrderAt.Equal(taken) {
				sup = append(sup, k.SupplierID)
				sto = append(sto, k.StoreID)
				pro = append(pro, k.ProductID)
				wh = append(wh, k.WarehouseID)
			}
		}

		if len(sup) == 0 {
			continue
		}

		err = tx.Exec(p116Fallback, p116Array(sup), p116Array(sto), p116Array(pro), p116Array(wh)).Error
		if err != nil {
			return fmt.Errorf("probe116 last-order fallback of transaction %d: %w", id, err)
		}

		p116Fallbacks.Add(1)
		p116FallbackKeys.Add(int64(len(sup)))
	}

	return nil
}

// ── The OLD reads, VERBATIM (HEAD 887a2c8a) ──────────────────────────────────────────────────────────────────────────

type p116Sold struct {
	SupplierID uint64
	K          uint64
	Sold       int64
	Orders     int64
	LastOrder  *time.Time
}

// p116OldKey is supplierGoodsKey, verbatim.
func p116OldKey(group inventoryv1.SupplierGoodsGroup) string {
	switch group {
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER:
		return "0"
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE:
		return "b.supplier_channel_id"
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE:
		return "b.warehouse_id"
	}

	return ""
}

// p116OldSold is supplierGoodsRows.sold (supplier_goods.go:212), verbatim — the receiver's warehouse a parameter.
func p116OldSold(db *gorm.DB, key string, warehouseID uint64, ids []uint64) ([]p116Sold, error) {
	var scans []p116Sold

	inWarehouse := ""
	args := []any{string(inventory_service_models.TxOrder), ids}

	if warehouseID > 0 {
		inWarehouse = " AND b.warehouse_id = ?"
		args = append(args, warehouseID)
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
				WHERE b.supplier_id IN ?`+inWarehouse+`
				GROUP BY b.supplier_id, k, l.transaction_id
			) per_order
			GROUP BY supplier_id, k
			ORDER BY supplier_id, k`, args...).
		Scan(&scans).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier goods sold: %w", err)
	}

	return scans, nil
}

// p116OldStoreProductGoods is SupplierStoreProductGoods (supplier_store_product_goods.go:48), verbatim.
func p116OldStoreProductGoods(
	ctx context.Context,
	db *gorm.DB,
	supplierID uint64,
	warehouseID uint64,
	pairs []inventory_v1.StoreProduct,
) ([]inventory_v1.StoreProductGoods, error) {
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

	out := make([]inventory_v1.StoreProductGoods, 0, len(scans))
	for _, sc := range scans {
		out = append(out, inventory_v1.StoreProductGoods{
			StoreProduct: inventory_v1.StoreProduct{StoreID: sc.StoreID, ProductID: sc.ProductID},
			Sold:         sc.Sold,
			Orders:       sc.Orders,
			LastOrder:    sc.LastOrder,
			Ready:        sc.Ready,
		})
	}

	return out, nil
}

// ── The NEW reads, on the totals ─────────────────────────────────────────────────────────────────────────────────

// p116NewSold is SupplierGoods' sold read from the totals: one index range per supplier on the primary key.
func p116NewSold(db *gorm.DB, group inventoryv1.SupplierGoodsGroup, warehouseID uint64, ids []uint64) ([]p116Sold, error) {
	key, orders := "0", "orders_supplier"

	switch group {
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE:
		key, orders = "store_id", "orders_store"
	case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE:
		key = "warehouse_id"
	}

	query := db.
		Table(p116Table).
		Select("supplier_id, "+key+" AS k, SUM(sold_units) AS sold, SUM("+orders+") AS orders, MAX(last_order_at) AS last_order").
		Where("supplier_id IN ?", ids)

	if warehouseID > 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	var scans []p116Sold

	err := query.
		Group("supplier_id, k").
		Order("supplier_id, k").
		Scan(&scans).
		Error
	if err != nil {
		return nil, fmt.Errorf("totals sold: %w", err)
	}

	return scans, nil
}

// p116NaiveSold sums the per-key `orders` at every grain — what option A gives WITHOUT the store and supplier counters.
func p116NaiveSold(db *gorm.DB, group inventoryv1.SupplierGoodsGroup, warehouseID uint64, ids []uint64) ([]p116Sold, error) {
	key := map[inventoryv1.SupplierGoodsGroup]string{
		inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER:  "0",
		inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE:     "store_id",
		inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE: "warehouse_id",
	}[group]

	query := db.
		Table(p116Table).
		Select("supplier_id, "+key+" AS k, SUM(sold_units) AS sold, SUM(orders) AS orders, MAX(last_order_at) AS last_order").
		Where("supplier_id IN ?", ids)

	if warehouseID > 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	var scans []p116Sold

	err := query.
		Group("supplier_id, k").
		Order("supplier_id, k").
		Scan(&scans).
		Error

	return scans, err
}

// p116Merged is SupplierGoods' whole answer with its sold from `sold`: ready and restocks VERBATIM
// (supplier_goods.go:148/176), merged in first-touch order as supplierGoodsRows.at does.
func p116Merged(db *gorm.DB, group inventoryv1.SupplierGoodsGroup, warehouseID uint64, ids []uint64,
	sold func(*gorm.DB, inventoryv1.SupplierGoodsGroup, uint64, []uint64) ([]p116Sold, error),
) ([]*inventoryv1.SupplierGoods, error) {
	key := p116OldKey(group)
	byKey := map[[2]uint64]*inventoryv1.SupplierGoods{}

	var list []*inventoryv1.SupplierGoods

	at := func(supplierID, k uint64) *inventoryv1.SupplierGoods {
		row, ok := byKey[[2]uint64{supplierID, k}]
		if ok {
			return row
		}

		row = &inventoryv1.SupplierGoods{SupplierId: supplierID}
		switch group {
		case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE:
			row.StoreId = k
		case inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE:
			row.WarehouseId = k
		}

		byKey[[2]uint64{supplierID, k}] = row
		list = append(list, row)

		return row
	}

	inWarehouse := func(query *gorm.DB) *gorm.DB {
		if warehouseID == 0 {
			return query
		}

		return query.Where("b.warehouse_id = ?", warehouseID)
	}

	var ready []struct {
		SupplierID uint64
		K          uint64
		Ready      int64
	}

	err := inWarehouse(db.
		Table(inventory_service_models.Batch{}.TableName()+" AS b")).
		Select("b.supplier_id, "+key+" AS k, SUM(b.stock_count) AS ready").
		Where("b.supplier_id IN ?", ids).
		Where("b.stock_count > 0").
		Group("b.supplier_id, k").
		Order("b.supplier_id, k").
		Scan(&ready).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier goods ready: %w", err)
	}

	for _, sc := range ready {
		at(sc.SupplierID, sc.K).ReadyUnits = sc.Ready
	}

	var restocks []struct {
		SupplierID  uint64
		K           uint64
		Restocks    int64
		LastRestock *time.Time
	}

	err = inWarehouse(db.
		Table(inventory_service_models.Batch{}.TableName()+" AS b")).
		Select("b.supplier_id, "+key+" AS k, COUNT(DISTINCT b.transaction_id) AS restocks, MAX(b.created_at) AS last_restock").
		Joins("JOIN inventory_transactions t ON t.id = b.transaction_id").
		Where("b.supplier_id IN ?", ids).
		Where("t.tx_type = ?", string(inventory_service_models.TxRestock)).
		Group("b.supplier_id, k").
		Order("b.supplier_id, k").
		Scan(&restocks).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier goods restocks: %w", err)
	}

	for _, sc := range restocks {
		row := at(sc.SupplierID, sc.K)
		row.Restocks = sc.Restocks
		row.LastRestockUnix = unixOrZero(sc.LastRestock)
	}

	scans, err := sold(db, group, warehouseID, ids)
	if err != nil {
		return nil, err
	}

	for _, sc := range scans {
		row := at(sc.SupplierID, sc.K)
		row.SoldUnits = sc.Sold
		row.Orders = sc.Orders
		row.LastOrderUnix = unixOrZero(sc.LastOrder)
	}

	return list, nil
}

func unixOrZero(t *time.Time) int64 {
	if t == nil {
		return 0
	}

	return t.Unix()
}

func p116OldSoldOf(db *gorm.DB, group inventoryv1.SupplierGoodsGroup, warehouseID uint64, ids []uint64) ([]p116Sold, error) {
	return p116OldSold(db, p116OldKey(group), warehouseID, ids)
}

// p116NewStoreProductGoods is the Produk tab on the totals: Siap from the page's batches as before, Terjual / orders /
// last order from the totals rows of each pair (the primary key's (supplier, store, product) prefix).
func p116NewStoreProductGoods(
	ctx context.Context,
	db *gorm.DB,
	supplierID uint64,
	warehouseID uint64,
	pairs []inventory_v1.StoreProduct,
) ([]inventory_v1.StoreProductGoods, error) {
	if supplierID == 0 || len(pairs) == 0 {
		return nil, nil
	}

	stores := make([]uint64, 0, len(pairs))
	products := make([]uint64, 0, len(pairs))

	for _, pair := range pairs {
		stores = append(stores, pair.StoreID)
		products = append(products, pair.ProductID)
	}

	inWarehouse, inTotals := "", ""
	args := []any{p116Array(stores), p116Array(products), supplierID}

	if warehouseID > 0 {
		inWarehouse = " AND b.warehouse_id = ?"
		args = append(args, warehouseID)
	}

	args = append(args, supplierID)

	if warehouseID > 0 {
		inTotals = " AND t.warehouse_id = ?"
		args = append(args, warehouseID)
	}

	var scans []struct {
		StoreID   uint64
		ProductID uint64
		Ready     int64
		Sold      int64
		Orders    int64
		LastOrder *time.Time
	}

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
			sold AS (
				SELECT p.store_id, p.product_id, t.sold_units, t.orders, t.last_order_at
				FROM pairs p
				JOIN probe116_supplier_goods_totals t
				  ON t.supplier_id = ? AND t.store_id = p.store_id AND t.product_id = p.product_id`+inTotals+`
			),
			parts AS (
				SELECT store_id, product_id, GREATEST(stock_count, 0) AS ready,
				       0::bigint AS sold, 0::bigint AS orders, NULL::timestamptz AS last_order
				FROM page_batches
				UNION ALL
				SELECT store_id, product_id, 0, sold_units, orders, last_order_at
				FROM sold
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
		return nil, fmt.Errorf("totals goods per store and product: %w", err)
	}

	out := make([]inventory_v1.StoreProductGoods, 0, len(scans))
	for _, sc := range scans {
		out = append(out, inventory_v1.StoreProductGoods{
			StoreProduct: inventory_v1.StoreProduct{StoreID: sc.StoreID, ProductID: sc.ProductID},
			Sold:         sc.Sold,
			Orders:       sc.Orders,
			LastOrder:    sc.LastOrder,
			Ready:        sc.Ready,
		})
	}

	return out, nil
}

// p116NewBand is the Terjual band on the totals.
func p116NewBand(t testing.TB, db *gorm.DB, lo, hi int64) []uint64 {
	t.Helper()

	query := db.
		Table(p116Table).
		Select("supplier_id").
		Where("supplier_id <> 0").
		Group("supplier_id").
		Having("SUM(sold_units) >= ?", lo)

	if hi > 0 {
		query = query.Having("SUM(sold_units) < ?", hi)
	}

	var ids []uint64

	err := query.
		Order("supplier_id").
		Pluck("supplier_id", &ids).
		Error
	if err != nil {
		t.Fatalf("totals Terjual [%d, %d): %v", lo, hi, err)
	}

	return ids
}

// ── Comparing ────────────────────────────────────────────────────────────────────────────────────────────────────

func p116SameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	return a.Equal(*b)
}

func p116DiffSold(old, now []p116Sold) string {
	if len(old) != len(now) {
		return fmt.Sprintf("%d rows vs %d rows: %s vs %s", len(old), len(now), p116ShowSold(old), p116ShowSold(now))
	}

	for i := range old {
		o, n := old[i], now[i]
		if o.SupplierID != n.SupplierID || o.K != n.K || o.Sold != n.Sold || o.Orders != n.Orders || !p116SameTime(o.LastOrder, n.LastOrder) {
			return fmt.Sprintf("row %d: %s vs %s", i, p116ShowSold(old[i:i+1]), p116ShowSold(now[i:i+1]))
		}
	}

	return ""
}

func p116ShowSold(rows []p116Sold) string {
	parts := make([]string, 0, len(rows))
	for _, r := range rows {
		last := "-"
		if r.LastOrder != nil {
			last = r.LastOrder.UTC().Format(time.RFC3339Nano)
		}

		parts = append(parts, fmt.Sprintf("{s%d k%d sold %d orders %d last %s}", r.SupplierID, r.K, r.Sold, r.Orders, last))
	}

	return strings.Join(parts, " ")
}

func p116DiffRows(old, now []*inventoryv1.SupplierGoods) string {
	if len(old) != len(now) {
		return fmt.Sprintf("%d rows vs %d rows", len(old), len(now))
	}

	for i := range old {
		if !proto.Equal(old[i], now[i]) {
			return fmt.Sprintf("row %d: %v vs %v", i, old[i], now[i])
		}
	}

	return ""
}

func p116DiffPairs(old, now []inventory_v1.StoreProductGoods) string {
	if len(old) != len(now) {
		return fmt.Sprintf("%d pairs vs %d pairs", len(old), len(now))
	}

	for i := range old {
		o, n := old[i], now[i]
		if o.StoreProduct != n.StoreProduct || o.Sold != n.Sold || o.Orders != n.Orders || o.Ready != n.Ready ||
			!p116SameTime(o.LastOrder, n.LastOrder) {
			return fmt.Sprintf("pair %d: %+v vs %+v", i, o, n)
		}
	}

	return ""
}

func p116Production(t testing.TB, svc *inventory_v1.Service, group inventoryv1.SupplierGoodsGroup, warehouseID uint64, ids []uint64) []*inventoryv1.SupplierGoods {
	t.Helper()

	res, err := svc.SupplierGoods(context.Background(), connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
		TeamId: 2, SupplierIds: ids, Group: group, WarehouseId: warehouseID,
	}))
	if err != nil {
		t.Fatalf("SupplierGoods %v at %d: %v", group, warehouseID, err)
	}

	return res.Msg.GetRows()
}

// p116Pairs is every (store, product) a supplier's batches carry, plus one it has none of.
func p116Pairs(t testing.TB, db *gorm.DB, supplierID uint64, limit int) []inventory_v1.StoreProduct {
	t.Helper()

	return p116PairsAt(t, db, supplierID, 0, limit)
}

// p116PairsAt is p116Pairs of the batches in one warehouse (0 = every warehouse) — a chip's Produk page.
func p116PairsAt(t testing.TB, db *gorm.DB, supplierID, warehouseID uint64, limit int) []inventory_v1.StoreProduct {
	t.Helper()

	var pairs []inventory_v1.StoreProduct

	err := db.Raw(`SELECT DISTINCT supplier_channel_id AS store_id, product_id FROM batches
		WHERE supplier_id = ? AND (? = 0 OR warehouse_id = ?)
		ORDER BY 1, 2 LIMIT ?`, supplierID, warehouseID, warehouseID, limit).Scan(&pairs).Error
	if err != nil {
		t.Fatalf("pairs of %d: %v", supplierID, err)
	}

	return append(pairs, inventory_v1.StoreProduct{StoreID: 999_999, ProductID: 999_999})
}

var p116Groups = []inventoryv1.SupplierGoodsGroup{
	inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER,
	inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE,
	inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE,
}

// ── Equality on a fixture written through the real writes ────────────────────────────────────────────────────────

const (
	p116A uint64 = 61 // stores 611 and 612 — one product bought at both, an order across both
	p116B uint64 = 62 // no store — a market stall
	p116C uint64 = 63 // store 631 — its goods transferred to Gudang 6 and sold there
	p116D uint64 = 64 // store 641 — sold, every unit cancelled on a later day
	p116E uint64 = 65 // restocked, never sold

	p116Q1 uint64 = 871 // Melati's: A/611 then A/612 at Gudang 5 (an order draws across both stores)
	p116Q2 uint64 = 872 // Melati's: A/611 at Gudang 5
	p116Q3 uint64 = 873 // Sinar's, 10% markup: B at Gudang 5, C/631 at Gudang 6 — Melati borrows it
	p116Q4 uint64 = 874 // Melati's: C/631 at Gudang 5, 30 transferred to Gudang 6 (sold there), 5 called back
	p116Q5 uint64 = 875 // Melati's: D/641 at Gudang 6
	p116Q6 uint64 = 876 // Melati's: from nobody
	p116Q7 uint64 = 877 // Sinar's: A/612 at Gudang 6 — 2 returned to Gudang 5 and sold from the return
	p116Q8 uint64 = 878 // Melati's: E at Gudang 5

	p116G5 uint64 = 5
	p116G6 uint64 = 6
)

var p116Suppliers = []uint64{p116A, p116B, p116C, p116D, p116E}

type p116Book struct {
	svc *inventory_v1.Service
	db  *gorm.DB
}

// p116Fixture: restocks, takes on six days (a tie on one key), multi-line orders inside one supplier and store and
// across suppliers, a FIFO draw across two stores, a borrowed line, cancels on later days (of the newest take on a key,
// of an older one, of a multi-supplier order), a transfer accepted and sold from, one called back, a return sold from.
func p116Fixture(t *testing.T, db *gorm.DB) p116Book {
	t.Helper()

	suppliers := fakeSupplierService{
		fakeSuppliers: fakeSuppliers{p116A: true, p116B: true, p116C: true, p116D: true, p116E: true},
		stores: map[uint64]inventory_v1.SupplierStore{
			611: {SupplierID: p116A, Live: true}, 612: {SupplierID: p116A, Live: true},
			631: {SupplierID: p116C, Live: true}, 641: {SupplierID: p116D, Live: true},
		},
	}
	facts := fakeFacts{
		p116Q1: {TeamID: sgMelati, ProductCode: "Q1", Name: "Q1"}, p116Q2: {TeamID: sgMelati, ProductCode: "Q2", Name: "Q2"},
		p116Q3: {TeamID: sgSinar, CrossMarkupBps: 1000, ProductCode: "Q3", Name: "Q3"},
		p116Q4: {TeamID: sgMelati, ProductCode: "Q4", Name: "Q4"}, p116Q5: {TeamID: sgMelati, ProductCode: "Q5", Name: "Q5"},
		p116Q6: {TeamID: sgMelati, ProductCode: "Q6", Name: "Q6"}, p116Q7: {TeamID: sgSinar, ProductCode: "Q7", Name: "Q7"},
		p116Q8: {TeamID: sgMelati, ProductCode: "Q8", Name: "Q8"},
	}
	sent := &sentEvents{}
	svc := inventory_v1.NewService(db, nil, nil, suppliers, sent.send, facts, nil, nil, nil, nil)

	r5 := newRack(t, svc, p116G5, "rak-p116-5")
	r6 := newRack(t, svc, p116G6, "rak-p116-6")

	for _, r := range []struct {
		team, warehouse, rack, product uint64
		count                          int64
		supplier, store                uint64
	}{
		{sgMelati, p116G5, r5, p116Q1, 30, p116A, 611},
		{sgMelati, p116G5, r5, p116Q1, 50, p116A, 612},
		{sgMelati, p116G5, r5, p116Q2, 40, p116A, 611},
		{sgSinar, p116G5, r5, p116Q3, 60, p116B, 0},
		{sgSinar, p116G6, r6, p116Q3, 30, p116C, 631},
		{sgMelati, p116G5, r5, p116Q4, 80, p116C, 631},
		{sgMelati, p116G6, r6, p116Q5, 20, p116D, 641},
		{sgMelati, p116G5, r5, p116Q6, 10, 0, 0},
		{sgSinar, p116G6, r6, p116Q7, 25, p116A, 612},
		{sgMelati, p116G5, r5, p116Q8, 5, p116E, 0},
	} {
		sgRestock(t, svc, r.team, r.warehouse, r.rack, r.product, r.count, r.supplier, r.store)
	}

	base := time.Date(2026, 11, 10, 10, 0, 0, 0, sgJakarta)
	at := func(day, hour int) context.Context {
		return inventory_ledgers.WithNow(ctxUser(8), base.AddDate(0, 0, day).Add(time.Duration(hour)*time.Hour))
	}

	type ln struct {
		product uint64
		qty     int64
	}

	takes := map[string]uint64{}

	take := func(ctx context.Context, team, warehouse uint64, key string, lines ...ln) {
		t.Helper()

		req := &inventoryv1.OrderTransactionCreateRequest{TeamId: team, IdempotencyKey: key, WarehouseId: warehouse}
		for _, l := range lines {
			req.Lines = append(req.Lines, &inventoryv1.OrderTransactionLine{ProductId: l.product, Quantity: l.qty})
		}

		res, err := svc.OrderTransactionCreate(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("take %s: %v", key, err)
		}

		takes[key] = res.Msg.GetTransactionId()
	}

	release := func(ctx context.Context, team uint64, key string) {
		t.Helper()

		res, err := svc.OrderTransactionRelease(ctx, connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: team, IdempotencyKey: key,
		}))
		if err != nil {
			t.Fatalf("release %s: %v", key, err)
		}

		if !res.Msg.GetReleased() {
			t.Fatalf("release %s: nothing released", key)
		}
	}

	take(at(0, 0), sgMelati, p116G5, "p116-o1", ln{p116Q1, 40}, ln{p116Q2, 5}) // Q1: 30 from A/611 + 10 from A/612
	take(at(0, 1), sgMelati, p116G5, "p116-o2", ln{p116Q2, 3})
	take(at(1, 0), sgMelati, p116G5, "p116-o3", ln{p116Q1, 2}, ln{p116Q3, 4}, ln{p116Q6, 1}) // borrowed Q3, nobody's Q6
	take(at(1, 0), sgSinar, p116G5, "p116-o4", ln{p116Q3, 10})                               // the same instant as o3
	take(at(1, 2), sgMelati, p116G6, "p116-o5", ln{p116Q5, 20})
	take(at(1, 3), sgMelati, p116G5, "p116-o6", ln{p116Q4, 10})

	wt := &wtFixture{svc: svc, db: db, sent: sent}

	tr := wt.create(t, wtLine(p116Q4, 30))
	wt.ship(t, tr.GetId())

	_, err := wt.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, p116Q4), 30, 0, r6))
	if err != nil {
		t.Fatalf("accept the transfer: %v", err)
	}

	back := wt.create(t, wtLine(p116Q4, 5))

	_, err = cancelTransfer(wt, sgMelati, back.GetId())
	if err != nil {
		t.Fatalf("cancel the second transfer: %v", err)
	}

	take(at(2, 1), sgMelati, p116G6, "p116-o7", ln{p116Q4, 12}) // from the transferred batch
	take(at(2, 2), sgSinar, p116G6, "p116-o9", ln{p116Q7, 5})

	_, err = svc.OrderTransactionReturn(at(2, 3), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: p116G5, SellingTeamId: sgSinar, TakeTransactionId: takes["p116-o9"], Description: "return of p116-o9",
		Lines: []*inventoryv1.OrderTransactionReturnLine{{
			ProductId: p116Q7, ReturnProductId: p116Q7, Sound: 2, Missing: 3,
			Placements: []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: r5, Quantity: 2}},
		}},
	}))
	if err != nil {
		t.Fatalf("return p116-o9: %v", err)
	}

	take(at(2, 4), sgMelati, p116G6, "p116-o11", ln{p116Q3, 3}) // borrowed Q3 at Gudang 6, from C
	release(at(2, 0), sgMelati, "p116-o5")                      // D: every unit back, a later day
	release(at(2, 5), sgSinar, "p116-o4")                       // the tie: o3 keeps the same instant as the last order
	take(at(3, 0), sgMelati, p116G5, "p116-o8", ln{p116Q1, 3}, ln{p116Q2, 2})
	release(at(3, 1), sgMelati, "p116-o8") // the newest take on its keys: the fallback finds o3 / o2
	take(at(3, 2), sgSinar, p116G5, "p116-o10", ln{p116Q7, 1})
	take(at(4, 0), sgMelati, p116G5, "p116-o12", ln{p116Q2, 1})
	take(at(4, 1), sgMelati, p116G5, "p116-o13", ln{p116Q2, 1})
	release(at(4, 2), sgMelati, "p116-o12") // an older take: the last order stays o13
	take(at(5, 0), sgMelati, p116G5, "p116-o14", ln{p116Q1, 5}, ln{p116Q2, 5}, ln{p116Q4, 5})
	release(at(5, 1), sgMelati, "p116-o14") // across two suppliers, three keys
	take(at(5, 2), sgMelati, p116G5, "p116-o15", ln{p116Q1, 1})

	return p116Book{svc: svc, db: db}
}

// EVERY READ, OLD AGAINST NEW, on totals the WRITER kept through the real takes, rollbacks, transfers and a return.
func TestProbe116_TheTotalsEqualTheOldQueries(t *testing.T) {
	db := san_testdb.DB(t)

	p116Install(t, db)
	p116CreateTable(t, db, p116Table)

	upserts, fallbacks := p116Upserts.Load(), p116Fallbacks.Load()

	p116On.Store(true)
	t.Cleanup(func() { p116On.Store(false) })

	f := p116Fixture(t, db)

	p116On.Store(false)

	t.Logf("the writer ran %d upserts and %d last-order fallbacks", p116Upserts.Load()-upserts, p116Fallbacks.Load()-fallbacks)

	if p116Upserts.Load()-upserts < 15 || p116Fallbacks.Load()-fallbacks < 3 {
		t.Fatalf("the writer did not ride the takes and rollbacks")
	}

	// 1. The writer's rows are the backfill's rows — a migration's backfill and the running writer agree.
	p116CreateTable(t, db, "probe116_backfill")
	p116Backfill(t, db, "probe116_backfill", "")

	var drift, rows int64

	err := db.Raw(`SELECT
		  (SELECT COUNT(*) FROM ((TABLE probe116_supplier_goods_totals EXCEPT TABLE probe116_backfill)
		                   UNION ALL (TABLE probe116_backfill EXCEPT TABLE probe116_supplier_goods_totals)) d),
		  (SELECT COUNT(*) FROM probe116_supplier_goods_totals)`).Row().Scan(&drift, &rows)
	if err != nil || drift != 0 || rows == 0 {
		t.Fatalf("writer vs backfill: %d of %d rows differ (%v)", drift, rows, err)
	}

	t.Logf("EQUAL writer vs backfill: %d rows, 0 differ", rows)

	// 2. SupplierGoods: every group × the chip × several id lists — the sold aggregate, then the whole answer.
	idLists := [][]uint64{p116Suppliers, {p116A}, {p116D}, {p116C, p116A}, {p116E, 99}}
	chips := []uint64{0, p116G5, p116G6, 98}
	cases, naiveDiffers := 0, 0

	for _, group := range p116Groups {
		for _, chip := range chips {
			for _, ids := range idLists {
				old, err := p116OldSold(db, p116OldKey(group), chip, ids)
				if err != nil {
					t.Fatal(err)
				}

				now, err := p116NewSold(db, group, chip, ids)
				if err != nil {
					t.Fatal(err)
				}

				if diff := p116DiffSold(old, now); diff != "" {
					t.Fatalf("sold %v chip %d ids %v: %s", group, chip, ids, diff)
				}

				naive, err := p116NaiveSold(db, group, chip, ids)
				if err != nil {
					t.Fatal(err)
				}

				if p116DiffSold(old, naive) != "" {
					naiveDiffers++
				}

				prod := p116Production(t, f.svc, group, chip, ids)

				merged, err := p116Merged(db, group, chip, ids, p116NewSold)
				if err != nil {
					t.Fatal(err)
				}

				if diff := p116DiffRows(prod, merged); diff != "" {
					t.Fatalf("SupplierGoods %v chip %d ids %v: production vs totals: %s", group, chip, ids, diff)
				}

				verbatim, err := p116Merged(db, group, chip, ids, p116OldSoldOf)
				if err != nil {
					t.Fatal(err)
				}

				if diff := p116DiffRows(prod, verbatim); diff != "" {
					t.Fatalf("SupplierGoods %v chip %d ids %v: the verbatim copy drifted from production: %s", group, chip, ids, diff)
				}

				cases++
			}
		}
	}

	whole, _ := p116OldSold(db, "0", 0, p116Suppliers)
	stores, _ := p116OldSold(db, "b.supplier_channel_id", 0, p116Suppliers)
	houses, _ := p116OldSold(db, "b.warehouse_id", 0, p116Suppliers)
	t.Logf("old per supplier: %s", p116ShowSold(whole))
	t.Logf("old per store: %s", p116ShowSold(stores))
	t.Logf("old per warehouse: %s", p116ShowSold(houses))

	if naiveDiffers == 0 {
		t.Fatalf("no case tells the per-key order count from the per-order one — the fixture proves nothing about orders")
	}

	t.Logf("EQUAL SupplierGoods: %d cases (3 groups × 4 chips × 5 id lists) — sold, orders, last order and the whole answer; "+
		"the per-key order count alone (no store/supplier counters) differs in %d of them", cases, naiveDiffers)

	// 3. The Produk tab: every pair of every supplier × the chip.
	pairCases := 0

	for _, supplier := range p116Suppliers {
		pairs := p116Pairs(t, db, supplier, 1000)

		for _, chip := range chips {
			prod, err := inventory_v1.SupplierStoreProductGoods(context.Background(), db, supplier, chip, pairs)
			if err != nil {
				t.Fatal(err)
			}

			old, err := p116OldStoreProductGoods(context.Background(), db, supplier, chip, pairs)
			if err != nil {
				t.Fatal(err)
			}

			now, err := p116NewStoreProductGoods(context.Background(), db, supplier, chip, pairs)
			if err != nil {
				t.Fatal(err)
			}

			if diff := p116DiffPairs(prod, old); diff != "" {
				t.Fatalf("store products %d chip %d: the verbatim copy drifted: %s", supplier, chip, diff)
			}

			if diff := p116DiffPairs(old, now); diff != "" {
				t.Fatalf("store products %d chip %d: %s", supplier, chip, diff)
			}

			pairCases++
		}
	}

	t.Logf("EQUAL SupplierStoreProductGoods: %d cases (5 suppliers × 4 chips, every pair + one absent)", pairCases)

	// 4. The Terjual band: every edge on, under and over each supplier's total and the pills.
	edges := []int64{0, 1, 500, 1000, 2500, 5000}
	for _, r := range whole {
		edges = append(edges, r.Sold-1, r.Sold, r.Sold+1)
	}

	bands := 0

	for _, lo := range edges {
		for _, hi := range append([]int64{0}, edges...) {
			if lo < 0 || (hi != 0 && hi <= lo) {
				continue
			}

			ledger := ledgerSoldIDs(t, db, lo, hi)

			fold, err := f.svc.SupplierIDsByFigure(context.Background(), inventory_v1.SupplierFigureSold, lo, hi)
			if err != nil {
				t.Fatal(err)
			}

			now := p116NewBand(t, db, lo, hi)
			if !slices.Equal(ledger, now) || !slices.Equal(fold, now) {
				t.Fatalf("band [%d, %d): ledger %v, fold %v, totals %v", lo, hi, ledger, fold, now)
			}

			bands++
		}
	}

	t.Logf("EQUAL Terjual band: %d bands — ledger (pre-fold) = fold (production) = totals", bands)
}

// ── Timing helpers ───────────────────────────────────────────────────────────────────────────────────────────────

func p116Time(t *testing.T, name string, runs int, fn func() error) time.Duration {
	t.Helper()

	err := fn()
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, runs)

	for range runs {
		start := time.Now()

		err = fn()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		walls = append(walls, time.Since(start))
	}

	slices.Sort(walls)

	t.Logf("P116 TIME %s runs=%d median=%v min=%v max=%v", name, runs, walls[len(walls)/2], walls[0], walls[len(walls)-1])

	return walls[len(walls)/2]
}

// p116Pair times old → new → new → old on one seed and logs both medians of each.
func p116Pair(t *testing.T, name string, runs int, old, now func() error) {
	t.Helper()

	o1 := p116Time(t, "BEFORE "+name, runs, old)
	n1 := p116Time(t, "AFTER "+name, runs, now)
	n2 := p116Time(t, "AFTER "+name, runs, now)
	o2 := p116Time(t, "BEFORE "+name, runs, old)

	t.Logf("P116 PAIR %s | before %v · %v | after %v · %v", name, o1, o2, n1, n2)
}

func p116Vacuum(t *testing.T, tables ...string) {
	t.Helper()

	pool := san_testdb.Pool(t).Session(&gorm.Session{Logger: logger.Discard})

	for _, table := range tables {
		var exists bool

		pool.Raw(`SELECT to_regclass(?) IS NOT NULL`, table).Scan(&exists)
		if !exists {
			continue
		}

		err := pool.Exec("VACUUM ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("vacuum %s: %v", table, err)
		}
	}
}

// ── The volume: SupplierGoods.md's background, the order rows in the take's own warehouse ───────────────────────

// p116Background is perfSupplierGoodsBackground's volume (200 000 batches, 500 000 orders × 2 rows, supplier 7 holding a
// tenth of the batches, 3 000 others) with two changes that make it a real ledger's shape: each order's rows land on
// batches IN ITS OWN WAREHOUSE (a take draws in one warehouse; the audit's seed picks any batch), and the one order in
// fifty marked rolled back really is — its rows are flipped an hour later. Then supplier 8: two hot keys, 10 000 and
// 100 000 orders on ONE (store, product, warehouse) each.
func p116Background(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	for _, sql := range []string{
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		   SELECT 5 + (g % 20), 100 + (g % 30), 'restock', NOW() - g * INTERVAL '10 minutes', NOW()
		   FROM generate_series(1, 50000) g
		   RETURNING id, warehouse_id, team_id, created_at
		 )
		 INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		 SELECT t.warehouse_id, t.team_id, 1000 + ((t.id * 4 + n) % 5000), t.id, 10000, (t.id + n) % 12, ((t.id + n) % 12) * 10000,
		        20, 200000,
		        CASE WHEN t.id % 10 = 0 THEN 7 WHEN t.id % 3 = 0 THEN 0 ELSE 100 + t.id % 3000 END,
		        CASE WHEN t.id % 3 = 0 AND t.id % 10 <> 0 THEN 0 ELSE 1 + (t.id % 4) END,
		        t.created_at, NOW()
		 FROM t CROSS JOIN generate_series(1, 4) n`,
		`CREATE TEMP TABLE p116_bw ON COMMIT DROP AS
		 SELECT id AS batch_id, warehouse_id, team_id, ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY id) - 1 AS rn
		 FROM batches`,
		`CREATE INDEX ON p116_bw (warehouse_id, rn)`,
		`CREATE TEMP TABLE p116_bn ON COMMIT DROP AS SELECT warehouse_id, COUNT(*) AS n FROM p116_bw GROUP BY 1`,
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, is_rollback, created_at, updated_at)
		   SELECT 5 + (g % 20), 100 + (g % 30), 'order', g % 50 = 0, NOW() - g * INTERVAL '1 minute', NOW()
		   FROM generate_series(1, 500000) g
		   RETURNING id, warehouse_id, created_at, is_rollback
		 ), picks AS (
		   SELECT t.id, t.warehouse_id, t.created_at, t.is_rollback, bw.batch_id, bw.team_id
		   FROM t
		   JOIN p116_bn c ON c.warehouse_id = t.warehouse_id
		   CROSS JOIN generate_series(1, 2) AS s(pick)
		   JOIN p116_bw bw ON bw.warehouse_id = t.warehouse_id
		    AND bw.rn = (hashtext(t.id::text || '.' || s.pick::text)::bigint & 2147483647) % c.n
		 )
		 INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		 SELECT warehouse_id, team_id, batch_id, id, 'order', -1, -10000, 1, 10000, 10000, '', 1, created_at FROM picks
		 UNION ALL
		 SELECT warehouse_id, team_id, batch_id, id, 'order', 1, 10000, 1, 10000, 10000, 'rollback', 1,
		        created_at + INTERVAL '1 hour'
		 FROM picks WHERE is_rollback`,
		// Supplier 8's hot keys: 50 batches of (store 1, product 990001) at Gudang 5, 200 of (store 2, product 990002) at 6.
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		   VALUES (5, 100, 'restock', NOW() - INTERVAL '400 days', NOW()), (6, 100, 'restock', NOW() - INTERVAL '400 days', NOW())
		   RETURNING id, warehouse_id
		 )
		 INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		 SELECT t.warehouse_id, 100, 990000 + t.warehouse_id - 4, t.id, 10000, 5, 50000, 1000, 10000000, 8,
		        t.warehouse_id - 4, NOW() - INTERVAL '400 days', NOW()
		 FROM t CROSS JOIN LATERAL generate_series(1, CASE t.warehouse_id WHEN 5 THEN 50 ELSE 200 END) k`,
		`CREATE TEMP TABLE p116_hot ON COMMIT DROP AS
		 SELECT id AS batch_id, warehouse_id, ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY id) - 1 AS rn,
		        COUNT(*) OVER (PARTITION BY warehouse_id) AS n
		 FROM batches WHERE supplier_id = 8`,
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, is_rollback, created_at, updated_at)
		   SELECT CASE WHEN g <= 10000 THEN 5 ELSE 6 END, 100 + g % 30, 'order', g % 50 = 0, NOW() - g * INTERVAL '20 seconds', NOW()
		   FROM generate_series(1, 110000) g
		   RETURNING id, warehouse_id, created_at, is_rollback
		 ), picks AS (
		   SELECT t.id, t.warehouse_id, t.created_at, t.is_rollback, h.batch_id
		   FROM t JOIN p116_hot h ON h.warehouse_id = t.warehouse_id AND h.rn = t.id % h.n
		 )
		 INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		 SELECT warehouse_id, 100, batch_id, id, 'order', -1, -10000, 1, 10000, 10000, '', 1, created_at FROM picks
		 UNION ALL
		 SELECT warehouse_id, 100, batch_id, id, 'order', 1, 10000, 1, 10000, 10000, 'rollback', 1, created_at + INTERVAL '1 hour'
		 FROM picks WHERE is_rollback`,
		"ANALYZE batches",
		"ANALYZE batch_logs",
		"ANALYZE inventory_transactions",
	} {
		err := quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("probe116 background: %v\n%s", err, sql)
		}
	}
}

// THE READS AT VOLUME: equality per grain over every supplier, then old against new, each case old → new → new → old.
func TestPerf_Probe116_Reads(t *testing.T) {
	p116Vacuum(t, "batches", "batch_logs", "inventory_transactions", "inventory_stock_daily_changes")

	db := san_testdb.DB(t)

	start := time.Now()

	p116Background(t, db)
	perfFoldDailyChanges(t, db)
	t.Logf("P116 seed: %v", time.Since(start))

	start = time.Now()

	p116CreateTable(t, db, p116Table)
	p116Backfill(t, db, p116Table, "")

	err := db.Exec("ANALYZE " + p116Table).Error
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("P116 backfill: %v", time.Since(start))

	var counts struct {
		OrderRows, BigRows, HotRows, Totals, Fold int64
	}

	err = db.Raw(`SELECT
		  (SELECT COUNT(*) FROM batch_logs WHERE change_type = 'order') AS order_rows,
		  (SELECT COUNT(*) FROM batch_logs l JOIN batches b ON b.id = l.batch_id WHERE l.change_type = 'order' AND b.supplier_id = 7) AS big_rows,
		  (SELECT COUNT(*) FROM batch_logs l JOIN batches b ON b.id = l.batch_id WHERE l.change_type = 'order' AND b.supplier_id = 8) AS hot_rows,
		  (SELECT COUNT(*) FROM probe116_supplier_goods_totals) AS totals,
		  (SELECT COUNT(*) FROM inventory_stock_daily_changes WHERE change_type = 'order') AS fold`).Scan(&counts).Error
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("P116 volume: %d order rows (supplier 7: %d, supplier 8: %d), %d totals rows, %d fold order rows",
		counts.OrderRows, counts.BigRows, counts.HotRows, counts.Totals, counts.Fold)

	// EQUALITY PER GRAIN, every supplier: the old netting (per order transaction at the grain) against the totals.
	for _, g := range []struct{ name, cols, orders string }{
		{"supplier", "b.supplier_id", "orders_supplier"},
		{"supplier × store", "b.supplier_id, b.supplier_channel_id", "orders_store"},
		{"supplier × warehouse", "b.supplier_id, b.warehouse_id", "orders_supplier"},
		{"supplier × store × warehouse", "b.supplier_id, b.supplier_channel_id, b.warehouse_id", "orders_store"},
		{"supplier × store × product", "b.supplier_id, b.supplier_channel_id, b.product_id", "orders"},
		{"supplier × store × product × warehouse", "b.supplier_id, b.supplier_channel_id, b.product_id, b.warehouse_id", "orders"},
		{"NAIVE supplier (per-key orders summed)", "b.supplier_id", "orders"},
	} {
		names := strings.NewReplacer("b.supplier_channel_id", "store_id", "b.", "").Replace(g.cols)

		var differ, keys int64

		err = db.Raw(`
			WITH per_tx AS (
			    SELECT `+g.cols+`, l.transaction_id, SUM(l.change_count) AS net,
			           MAX(l.created_at) FILTER (WHERE l.change_count < 0) AS taken_at
			    FROM batch_logs l JOIN batches b ON b.id = l.batch_id
			    WHERE l.change_type = 'order' AND b.supplier_id <> 0
			    GROUP BY `+g.cols+`, l.transaction_id
			), old AS (
			    SELECT `+strings.ReplaceAll(names, "store_id", "supplier_channel_id AS store_id")+`, -SUM(net) AS sold,
			           COUNT(*) FILTER (WHERE net < 0) AS orders, MAX(taken_at) FILTER (WHERE net < 0) AS last_order
			    FROM per_tx GROUP BY `+strings.ReplaceAll(names, "store_id", "supplier_channel_id")+`
			), now AS (
			    SELECT `+names+`, SUM(sold_units) AS sold, SUM(`+g.orders+`) AS orders, MAX(last_order_at) AS last_order
			    FROM probe116_supplier_goods_totals GROUP BY `+names+`
			)
			SELECT COUNT(*) FILTER (WHERE old.sold IS DISTINCT FROM now.sold OR old.orders IS DISTINCT FROM now.orders
			                           OR old.last_order IS DISTINCT FROM now.last_order),
			       COUNT(*)
			FROM old FULL JOIN now USING (`+names+`)`).Row().Scan(&differ, &keys)
		if err != nil {
			t.Fatalf("grain %s: %v", g.name, err)
		}

		t.Logf("P116 EQUAL at volume, per %s: %d keys, %d differ", g.name, keys, differ)

		if differ != 0 && !strings.HasPrefix(g.name, "NAIVE") {
			t.Fatalf("at volume, per %s: %d of %d keys differ", g.name, differ, keys)
		}
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	page := make([]uint64, 0, 50)
	for i := range 50 {
		page = append(page, 101+uint64(i)*3)
	}

	bigPage := append([]uint64{perfBigSupplier}, page[:49]...)

	var bigHouse uint64

	err = db.Raw(`SELECT warehouse_id FROM batches WHERE supplier_id = 7 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`).Scan(&bigHouse).Error
	if err != nil {
		t.Fatal(err)
	}

	type readCase struct {
		name      string
		group     inventoryv1.SupplierGoodsGroup
		warehouse uint64
		ids       []uint64
		runs      int
	}

	cases := []readCase{
		{"list page of 50 (GROUP_SUPPLIER)", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, 0, page, 5},
		{"list page with the big supplier", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, 0, bigPage, 3},
		{"big supplier by store", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, 0, []uint64{perfBigSupplier}, 3},
		{"big supplier by warehouse", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, 0, []uint64{perfBigSupplier}, 3},
		{"big supplier by store under its chip", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, bigHouse, []uint64{perfBigSupplier}, 3},
		{"small supplier by warehouse", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, 0, []uint64{101}, 5},
		{"hot supplier 8 (110k orders on 2 keys) by store", inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, 0, []uint64{8}, 3},
	}

	for _, c := range cases {
		prod := p116Production(t, svc, c.group, c.warehouse, c.ids)

		merged, err := p116Merged(db, c.group, c.warehouse, c.ids, p116NewSold)
		if err != nil {
			t.Fatal(err)
		}

		if diff := p116DiffRows(prod, merged); diff != "" {
			t.Fatalf("%s: production vs totals: %s", c.name, diff)
		}

		t.Logf("P116 EQUAL at volume, SupplierGoods %s: %d rows", c.name, len(prod))

		p116Pair(t, "SupplierGoods "+c.name, c.runs,
			func() error {
				_, err := svc.SupplierGoods(context.Background(), connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
					TeamId: 100, SupplierIds: c.ids, Group: c.group, WarehouseId: c.warehouse,
				}))

				return err
			},
			func() error {
				_, err := p116Merged(db, c.group, c.warehouse, c.ids, p116NewSold)

				return err
			})
	}

	// The sold statement alone, for the big supplier (the 5 s of the audit's pie).
	p116Pair(t, "sold statement, big supplier by store", 3,
		func() error {
			_, err := p116OldSold(db, "b.supplier_channel_id", 0, []uint64{perfBigSupplier})

			return err
		},
		func() error {
			_, err := p116NewSold(db, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, 0, []uint64{perfBigSupplier})

			return err
		})

	var plan []string

	err = db.Raw(`EXPLAIN (ANALYZE, BUFFERS) SELECT supplier_id, store_id AS k, SUM(sold_units) AS sold,
		SUM(orders_store) AS orders, MAX(last_order_at) AS last_order FROM probe116_supplier_goods_totals
		WHERE supplier_id IN (7) GROUP BY supplier_id, k ORDER BY supplier_id, k`).Scan(&plan).Error
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("P116 PLAN new sold, big supplier by store:\n%s", strings.Join(plan, "\n"))

	// The Produk tab: a page of the big supplier's 200 pairs, and under its chip.
	for _, chip := range []uint64{0, bigHouse} {
		pairs := p116PairsAt(t, db, perfBigSupplier, chip, 200)

		prod, err := inventory_v1.SupplierStoreProductGoods(context.Background(), db, perfBigSupplier, chip, pairs)
		if err != nil {
			t.Fatal(err)
		}

		now, err := p116NewStoreProductGoods(context.Background(), db, perfBigSupplier, chip, pairs)
		if err != nil {
			t.Fatal(err)
		}

		if diff := p116DiffPairs(prod, now); diff != "" {
			t.Fatalf("store products chip %d at volume: %s", chip, diff)
		}

		t.Logf("P116 EQUAL at volume, SupplierStoreProductGoods big supplier chip %d: %d pairs", chip, len(prod))

		p116Pair(t, fmt.Sprintf("SupplierStoreProductGoods 200 pairs of the big supplier, chip %d", chip), 5,
			func() error {
				_, err := inventory_v1.SupplierStoreProductGoods(context.Background(), db, perfBigSupplier, chip, pairs)

				return err
			},
			func() error {
				_, err := p116NewStoreProductGoods(context.Background(), db, perfBigSupplier, chip, pairs)

				return err
			})
	}

	hotPairs := p116Pairs(t, db, 8, 10)

	p116Pair(t, "SupplierStoreProductGoods hot supplier 8's pairs", 3,
		func() error {
			_, err := inventory_v1.SupplierStoreProductGoods(context.Background(), db, 8, 0, hotPairs)

			return err
		},
		func() error {
			_, err := p116NewStoreProductGoods(context.Background(), db, 8, 0, hotPairs)

			return err
		})

	// The Terjual band: production (the daily fold) against the totals — the same ids for every pill's question.
	for _, band := range [][2]int64{{500, 0}, {500, 1_000}, {1_000, 2_500}, {2_500, 5_000}, {5_000, 0}, {100, 200}, {0, 0}} {
		fold, err := svc.SupplierIDsByFigure(context.Background(), inventory_v1.SupplierFigureSold, band[0], band[1])
		if err != nil {
			t.Fatal(err)
		}

		now := p116NewBand(t, db, band[0], band[1])
		if !slices.Equal(fold, now) {
			t.Fatalf("band %v at volume: fold %d ids, totals %d ids", band, len(fold), len(now))
		}

		t.Logf("P116 EQUAL at volume, Terjual band %v: %d ids", band, len(now))
	}

	for _, band := range [][2]int64{{500, 0}, {500, 1_000}} {
		p116Pair(t, fmt.Sprintf("Terjual band %v", band), 5,
			func() error {
				_, err := svc.SupplierIDsByFigure(context.Background(), inventory_v1.SupplierFigureSold, band[0], band[1])

				return err
			},
			func() error {
				p116NewBand(t, db, band[0], band[1])

				return nil
			})
	}

	// PESANAN TERAKHIR's fallback: one key's last standing order re-read from the ledger — what a rollback of that
	// key's newest take pays. A typical key of the big supplier, its busiest, and supplier 8's 10k and 100k hot keys.
	type key struct {
		SupplierID, StoreID, ProductID, WarehouseID uint64
		Orders                                      int64
	}

	var keys []key

	err = db.Raw(`
		(SELECT supplier_id, store_id, product_id, warehouse_id, orders FROM probe116_supplier_goods_totals
		 WHERE supplier_id = 7 ORDER BY orders, product_id LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM probe116_supplier_goods_totals WHERE supplier_id = 7))
		UNION ALL
		(SELECT supplier_id, store_id, product_id, warehouse_id, orders FROM probe116_supplier_goods_totals
		 WHERE supplier_id = 7 ORDER BY orders DESC, product_id LIMIT 1)
		UNION ALL
		(SELECT supplier_id, store_id, product_id, warehouse_id, orders FROM probe116_supplier_goods_totals
		 WHERE supplier_id = 8 ORDER BY orders)`).Scan(&keys).Error
	if err != nil || len(keys) != 4 {
		t.Fatalf("fallback keys: %v (%d)", err, len(keys))
	}

	exact := fmt.Sprintf(p116LastStanding, "b.supplier_id = ? AND b.supplier_channel_id = ? AND b.product_id = ? AND b.warehouse_id = ?")

	// The bounded alternative: per batch of the key, its newest take row of an order not rolled back (id order), the
	// newest of those — exact only while a row's id order is its time order.
	bounded := `
		SELECT MAX(x.created_at) FROM batches b
		CROSS JOIN LATERAL (
		    SELECT l.created_at FROM batch_logs l JOIN inventory_transactions t ON t.id = l.transaction_id
		    WHERE l.batch_id = b.id AND l.change_type = 'order' AND l.change_count < 0 AND NOT t.is_rollback
		    ORDER BY l.id DESC LIMIT 1
		) x
		WHERE b.supplier_id = ? AND b.supplier_channel_id = ? AND b.product_id = ? AND b.warehouse_id = ?`

	for i, k := range keys {
		name := []string{"typical key of the big supplier", "busiest key of the big supplier", "hot key A", "hot key B"}[i]
		args := []any{k.SupplierID, k.StoreID, k.ProductID, k.WarehouseID}

		var want, got, alt *time.Time

		err = db.Raw(exact, args...).Row().Scan(&got)
		if err != nil {
			t.Fatal(err)
		}

		err = db.Raw(`SELECT last_order_at FROM probe116_supplier_goods_totals
			WHERE supplier_id = ? AND store_id = ? AND product_id = ? AND warehouse_id = ?`, args...).Row().Scan(&want)
		if err != nil || !p116SameTime(want, got) {
			t.Fatalf("fallback %s: %v vs totals %v (%v)", name, got, want, err)
		}

		err = db.Raw(bounded, args...).Row().Scan(&alt)
		if err != nil {
			t.Fatal(err)
		}

		label := fmt.Sprintf("Pesanan terakhir fallback, %s (%d standing orders)", name, k.Orders)

		p116Time(t, "EXACT "+label, 5, func() error {
			var v *time.Time

			return db.Raw(exact, args...).Row().Scan(&v)
		})
		p116Time(t, "BOUNDED "+label, 5, func() error {
			var v *time.Time

			return db.Raw(bounded, args...).Row().Scan(&v)
		})

		t.Logf("P116 fallback %s: exact = totals = %v, bounded alternative equal: %v", name, got, p116SameTime(got, alt))
	}

	// A PURE INDEX on the Produk tab's batch lookup (supplier, store, product): its Siap half reads the big supplier's
	// batches of a whole store per pair through batches_supplier_idx (supplier, store, warehouse) — not a sold cost, so the
	// totals cannot help it. Created inside the test transaction, measured, then dropped.
	err = db.Exec(`CREATE INDEX p116_batches_supplier_product_idx ON batches (supplier_id, supplier_channel_id, product_id, warehouse_id)`).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`ANALYZE batches`).Error
	if err != nil {
		t.Fatal(err)
	}

	for _, chip := range []uint64{0, bigHouse} {
		pairs := p116PairsAt(t, db, perfBigSupplier, chip, 200)

		p116Pair(t, fmt.Sprintf("WITH (supplier, store, product) INDEX SupplierStoreProductGoods 200 pairs of the big supplier, chip %d", chip), 5,
			func() error {
				_, err := inventory_v1.SupplierStoreProductGoods(context.Background(), db, perfBigSupplier, chip, pairs)

				return err
			},
			func() error {
				_, err := p116NewStoreProductGoods(context.Background(), db, perfBigSupplier, chip, pairs)

				return err
			})
	}

	err = db.Exec(`DROP INDEX p116_batches_supplier_product_idx`).Error
	if err != nil {
		t.Fatal(err)
	}
}

// ── The take and the rollback, committed, before and after ──────────────────────────────────────────────────────

func p116Stats(walls []time.Duration) string {
	sorted := slices.Clone(walls)
	slices.Sort(sorted)

	return fmt.Sprintf("n=%d p50=%v p95=%v min=%v max=%v", len(sorted), sorted[len(sorted)/2], sorted[len(sorted)*95/100],
		sorted[0], sorted[len(sorted)-1])
}

// THE ORDER TAKE AND ITS ROLLBACK, COMMITTED (TestPerf_OrderTakeLatency_Committed's shape and background, plus a year
// of totals rows): four phases on one seed — before, after, after, before — each 200 one-line takes + 60 twenty-line
// takes (the twenty products split over 3 suppliers × 2 stores), then every twenty-line take rolled back newest first
// (each the last order of its 20 keys — the fallback runs) and 170 of the one-line takes newest first (each the last
// order of its key). The after phases leave 31 one-line takes standing; the before phases release them untimed. It
// DELETEs from the shared ledger tables: run it alone (-p 1).
func TestPerf_Probe116_TakeAndRollback_Committed(t *testing.T) {
	db := san_testdb.Pool(t)

	clean := func() {
		for _, table := range append([]string{p116Table, "probe116_backfill"}, takeLatencyTables...) {
			var exists bool

			db.Raw(`SELECT to_regclass(?) IS NOT NULL`, table).Scan(&exists)
			if !exists {
				continue
			}

			sql := "DELETE FROM " + table
			if strings.HasPrefix(table, "probe116") {
				sql = "DROP TABLE " + table
			}

			err := db.Exec(sql).Error
			if err != nil {
				t.Fatalf("clean %s: %v", table, err)
			}
		}
	}

	clean()
	t.Cleanup(clean)
	p116Vacuum(t, takeLatencyTables...)

	p116Install(t, db)

	perfLedgerBackground(t, db)
	perfChangesBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil, nil, nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "p116-a"), newRack(t, svc, otWarehouse, "p116-b"), newRack(t, svc, otWarehouse, "p116-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	for _, sql := range []string{
		`UPDATE batches SET supplier_id = 500 + (product_id - 900001) % 3, supplier_channel_id = 5000 + (product_id - 900001) % 2
		 WHERE product_id BETWEEN 900001 AND 900020`,
		p116DDL,
		// The background totals: 200 000 keys of 3 001 suppliers (the index the take's upsert walks).
		`INSERT INTO probe116_supplier_goods_totals (supplier_id, store_id, product_id, warehouse_id, sold_units, orders,
		     orders_store, orders_supplier, last_order_at)
		 SELECT 100 + g % 3001, g % 4, 100000 + g, 1 + g % 20, 50, 10, 3, 1, NOW() - g * INTERVAL '1 minute'
		 FROM generate_series(1, 200000) g`,
		"ANALYZE batches",
		"ANALYZE " + p116Table,
	} {
		err := quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("committed probe seed: %v", err)
		}
	}

	t.Cleanup(func() { p116On.Store(false) })

	type phaseResult struct {
		mode                     string
		take1, take20, rb20, rb1 []time.Duration
		upserts, fallbacks       int64
	}

	var results []phaseResult

	for phase, on := range []bool{false, true, true, false} {
		mode := map[bool]string{false: "BEFORE", true: "AFTER"}[on]
		p116On.Store(on)

		upserts, fallbacks := p116Upserts.Load(), p116Fallbacks.Load()
		r := phaseResult{mode: mode}

		takeOf := func(size, n int) string { return fmt.Sprintf("p116:%d:%d:%d", phase, size, n) }

		for _, run := range []struct{ size, takes int }{{1, 200}, {20, 60}} {
			lines := make([]*inventoryv1.OrderTransactionLine, 0, run.size)
			for _, product := range perfProducts(run.size) {
				lines = append(lines, line(product, 1))
			}

			for n := 0; n <= run.takes; n++ {
				begin := time.Now()

				_, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
					TeamId: otMelati, IdempotencyKey: takeOf(run.size, n), WarehouseId: otWarehouse, Lines: lines,
				}))
				if err != nil {
					t.Fatalf("phase %d take lines=%d #%d: %v", phase, run.size, n, err)
				}

				if n == 0 {
					continue // warm-up
				}

				if run.size == 1 {
					r.take1 = append(r.take1, time.Since(begin))
				} else {
					r.take20 = append(r.take20, time.Since(begin))
				}
			}
		}

		release := func(key string) time.Duration {
			begin := time.Now()

			res, err := svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
				TeamId: otMelati, IdempotencyKey: key,
			}))
			if err != nil || !res.Msg.GetReleased() {
				t.Fatalf("phase %d release %s: %v", phase, key, err)
			}

			return time.Since(begin)
		}

		for n := 60; n >= 0; n-- {
			wall := release(takeOf(20, n))
			if n > 0 {
				r.rb20 = append(r.rb20, wall)
			}
		}

		for n := 200; n >= 31; n-- {
			r.rb1 = append(r.rb1, release(takeOf(1, n)))
		}

		if !on {
			for n := 30; n >= 0; n-- {
				release(takeOf(1, n))
			}
		}

		r.upserts, r.fallbacks = p116Upserts.Load()-upserts, p116Fallbacks.Load()-fallbacks
		results = append(results, r)

		t.Logf("P116 COMMITTED phase %d %s TAKE lines=1 %s", phase, mode, p116Stats(r.take1))
		t.Logf("P116 COMMITTED phase %d %s TAKE lines=20 %s", phase, mode, p116Stats(r.take20))
		t.Logf("P116 COMMITTED phase %d %s ROLLBACK lines=20 %s", phase, mode, p116Stats(r.rb20))
		t.Logf("P116 COMMITTED phase %d %s ROLLBACK lines=1 %s", phase, mode, p116Stats(r.rb1))
		t.Logf("P116 COMMITTED phase %d %s writer: %d upserts, %d fallbacks", phase, mode, r.upserts, r.fallbacks)
	}

	p116On.Store(false)

	for _, r := range results {
		if (r.mode == "AFTER") != (r.upserts > 0) {
			t.Fatalf("%s phase ran %d upserts", r.mode, r.upserts)
		}
	}

	// The writer's totals for the probe's keys equal the ledger's — after 2 × (261 + 261) writes and rollbacks. (The
	// background totals rows of suppliers 500–502 are synthetic, not the ledger's: left out.)
	p116CreateTable(t, quiet, "probe116_backfill")
	p116Backfill(t, quiet, "probe116_backfill", "b.supplier_id BETWEEN 500 AND 502")

	var drift, rows int64

	err := quiet.Raw(`SELECT
		  (SELECT COUNT(*) FROM ((SELECT * FROM probe116_supplier_goods_totals WHERE supplier_id BETWEEN 500 AND 502 AND product_id BETWEEN 900001 AND 900020
		                         EXCEPT TABLE probe116_backfill)
		                   UNION ALL (TABLE probe116_backfill EXCEPT
		                         SELECT * FROM probe116_supplier_goods_totals WHERE supplier_id BETWEEN 500 AND 502 AND product_id BETWEEN 900001 AND 900020)) d),
		  (SELECT COUNT(*) FROM probe116_backfill)`).Row().Scan(&drift, &rows)
	if err != nil || drift != 0 || rows == 0 {
		t.Fatalf("committed writer vs ledger: %d of %d rows differ (%v)", drift, rows, err)
	}

	var standing struct {
		Orders int64
		Sold   int64
	}

	quiet.Raw(`SELECT orders, sold_units AS sold FROM probe116_supplier_goods_totals
		WHERE supplier_id = 500 AND store_id = 5000 AND product_id = 900001 AND warehouse_id = ?`, otWarehouse).Scan(&standing)

	t.Logf("P116 EQUAL committed writer vs ledger: %d keys, 0 differ (product 1's key: %d standing orders, %d sold)",
		rows, standing.Orders, standing.Sold)

	sort.SliceStable(results, func(i, j int) bool { return results[i].mode < results[j].mode })

	for _, r := range results {
		t.Logf("P116 SUMMARY %s take1 %s | take20 %s | rb20 %s | rb1 %s", r.mode, p116Stats(r.take1), p116Stats(r.take20),
			p116Stats(r.rb20), p116Stats(r.rb1))
	}
}
