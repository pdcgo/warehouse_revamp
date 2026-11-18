//go:build perfaudit

// Performance audit for a supplier page's GUDANG TERKAIT CHIP over its Toko and Produk tabs
// (a-supplier-page-is-scoped-by-its-warehouses) — SupplierChannelList, SupplierProductList and both exports with a
// warehouse, plus the Toko tab's figures (InventoryService.SupplierGoods by STORE with the warehouse) — through the REAL
// wiring, on the Produk tab's probed volume (perfSpVolume, supplier_product_list_perf_test.go): 2 000 suppliers, 40 000
// links (the big supplier 4 000, ten stores), 100 000 batches over 8 warehouses, 300 000 `order` rows.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierWarehouseChip -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func TestPerf_SupplierWarehouseChip(t *testing.T) {
	raw := san_testdb.DB(t)

	for _, table := range []string{"supplier_channel_products", "batches", "batch_logs"} {
		var size int64

		err := raw.Raw(`SELECT pg_relation_size(?::regclass)`, table).Scan(&size).Error
		if err != nil {
			t.Fatalf("size of %s: %v", table, err)
		}

		t.Logf("before the seed: %s = %d bytes on disk", table, size)
	}

	perfSpVolume(t, raw)

	var ids struct {
		Big, Typical uint64
	}

	err := raw.Raw(`SELECT (SELECT id FROM suppliers WHERE name = 'PSP Pemasok 0001') AS big,
	                       (SELECT id FROM suppliers WHERE name = 'PSP Pemasok 1000') AS typical`).Scan(&ids).Error
	if err != nil {
		t.Fatal(err)
	}

	// The chip: the warehouse holding most of the big supplier's batches; the typical supplier's, its first batch's.
	var bigW, typicalW, bigStore uint64

	err = raw.Raw(`SELECT warehouse_id FROM batches WHERE supplier_id = ? GROUP BY warehouse_id ORDER BY COUNT(*) DESC LIMIT 1`,
		ids.Big).Scan(&bigW).Error
	if err != nil {
		t.Fatal(err)
	}

	err = raw.Raw(`SELECT warehouse_id FROM batches WHERE supplier_id = ? ORDER BY id LIMIT 1`, ids.Typical).Scan(&typicalW).Error
	if err != nil {
		t.Fatal(err)
	}

	err = raw.Raw(`SELECT id FROM supplier_channels WHERE supplier_id = ? ORDER BY id OFFSET 1 LIMIT 1`, ids.Big).Scan(&bigStore).Error
	if err != nil {
		t.Fatal(err)
	}

	var shape struct {
		BigBatches, BigBatchesAtW, BigPairsAtW int64
	}

	err = raw.Raw(`SELECT (SELECT COUNT(*) FROM batches WHERE supplier_id = ?) AS big_batches,
	                      (SELECT COUNT(*) FROM batches WHERE supplier_id = ? AND warehouse_id = ?) AS big_batches_at_w,
	                      (SELECT COUNT(DISTINCT (supplier_channel_id, product_id)) FROM batches
	                        WHERE supplier_id = ? AND warehouse_id = ?) AS big_pairs_at_w`,
		ids.Big, ids.Big, bigW, ids.Big, bigW).Scan(&shape).Error
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("the big supplier: %d batches, %d at its chip's warehouse, %d (store, product) pairs there",
		shape.BigBatches, shape.BigBatchesAtW, shape.BigPairsAtW)

	db, probe := san_perf.Wrap(raw)
	ctx := context.Background()
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	reader := NewSupplierGoodsReader(inventory, db)
	catalog := NewSupplierProductCatalog(product_v1.NewService(db, nil, nil, nil, nil))
	svc := supplier_v1.NewService(db, nil, nil, reader, perfSpStore{}, catalog)

	stores := func(supplierID, warehouse uint64) func() (string, error) {
		return func() (string, error) {
			res, err := svc.SupplierChannelList(ctx, connect.NewRequest(&supplierv1.SupplierChannelListRequest{
				TeamId: perfSpTeam, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: supplierID, WarehouseId: warehouse},
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if err != nil {
				return "", err
			}

			return fmt.Sprintf("%d of %d", len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems()), nil
		}
	}

	storeGoods := func(supplierID, warehouse uint64) func() (string, error) {
		return func() (string, error) {
			res, err := inventory.SupplierGoods(ctx, connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
				TeamId: perfSpTeam, SupplierIds: []uint64{supplierID},
				Group: inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, WarehouseId: warehouse,
			}))
			if err != nil {
				return "", err
			}

			return fmt.Sprintf("%d stores", len(res.Msg.GetRows())), nil
		}
	}

	products := func(filter *supplierv1.SupplierProductListFilter, pageNo, limit uint32) func() (string, error) {
		return func() (string, error) {
			res, err := svc.SupplierProductList(ctx, connect.NewRequest(&supplierv1.SupplierProductListRequest{
				TeamId: perfSpTeam, Filter: filter, Page: &commonv1.CommonPagination{Page: pageNo, Limit: limit},
			}))
			if err != nil {
				return "", err
			}

			return fmt.Sprintf("%d of %d", len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems()), nil
		}
	}

	mux := http.NewServeMux()
	mux.Handle(supplierv1connect.NewSupplierChannelServiceHandler(svc))

	server := httptest.NewServer(mux)
	defer server.Close()

	client := supplierv1connect.NewSupplierChannelServiceClient(http.DefaultClient, server.URL)

	productExport := func(filter *supplierv1.SupplierProductListFilter) func() (string, error) {
		return func() (string, error) {
			stream, err := client.SupplierProductExport(ctx, connect.NewRequest(&supplierv1.SupplierProductExportRequest{
				TeamId: perfSpTeam, Filter: filter,
			}))
			if err != nil {
				return "", err
			}
			defer func() { _ = stream.Close() }()

			var done int64
			for stream.Receive() {
				done = stream.Msg().GetDone()
			}

			return fmt.Sprintf("%d rows", done), stream.Err()
		}
	}

	storeExport := func(supplierID, warehouse uint64) func() (string, error) {
		return func() (string, error) {
			stream, err := client.SupplierChannelExport(ctx, connect.NewRequest(&supplierv1.SupplierChannelExportRequest{
				TeamId: perfSpTeam, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: supplierID, WarehouseId: warehouse},
			}))
			if err != nil {
				return "", err
			}
			defer func() { _ = stream.Close() }()

			var done int64
			for stream.Receive() {
				done = stream.Msg().GetDone()
			}

			return fmt.Sprintf("%d rows", done), stream.Err()
		}
	}

	big := func(f *supplierv1.SupplierProductListFilter) *supplierv1.SupplierProductListFilter {
		f.SupplierId = ids.Big
		f.WarehouseId = bigW
		return f
	}

	cases := []perfSpCase{
		{"Toko · typical · no chip", stores(ids.Typical, 0)},
		{"Toko · typical · chip", stores(ids.Typical, typicalW)},
		{"Toko · big · chip", stores(ids.Big, bigW)},
		{"Toko figures · big · no chip", storeGoods(ids.Big, 0)},
		{"Toko figures · big · chip", storeGoods(ids.Big, bigW)},
		{"Produk · typical · chip · page 1 × 20", products(&supplierv1.SupplierProductListFilter{SupplierId: ids.Typical, WarehouseId: typicalW}, 1, 20)},
		{"Produk · big · chip · page 1 × 20", products(big(&supplierv1.SupplierProductListFilter{}), 1, 20)},
		{"Produk · big · chip · page 1 × 50", products(big(&supplierv1.SupplierProductListFilter{}), 1, 50)},
		{"Produk · big · chip · page 30 × 20", products(big(&supplierv1.SupplierProductListFilter{}), 30, 20)},
		{"Produk · big · chip · q=katun", products(big(&supplierv1.SupplierProductListFilter{Q: "katun"}), 1, 20)},
		{"Produk · big · chip · one store", products(big(&supplierv1.SupplierProductListFilter{StoreId: bigStore}), 1, 20)},
		{"Produk · big · no chip · page 1 × 20 (P3 baseline)", products(&supplierv1.SupplierProductListFilter{SupplierId: ids.Big}, 1, 20)},
		{"export Toko · big · chip", storeExport(ids.Big, bigW)},
		{"export Produk · typical · chip", productExport(&supplierv1.SupplierProductListFilter{SupplierId: ids.Typical, WarehouseId: typicalW})},
		{"export Produk · big · chip", productExport(big(&supplierv1.SupplierProductListFilter{}))},
	}

	var summary strings.Builder

	summary.WriteString("\n| case | answer | queries | step medians, ms | wall median |\n|---|---|---|---|---|\n")

	for _, c := range cases {
		perfSpMeasure(t, probe, &summary, c)
	}

	t.Log(summary.String())

	// THE CONTROL: the arrays the big supplier's chip page binds (the two pair arrays; with a search, the matched products
	// too), bound to a query that does nothing with them — this host's loopback cost of big parameters, not the read's
	// (revamp-build-passes: the ≈ 25–30 KB stall).
	for _, c := range []perfSpCase{cases[6], cases[9]} {
		probe.Reset()

		_, err = c.run()
		if err != nil {
			t.Fatalf("control: %v", err)
		}

		perfChipControl(t, raw, c.name, probe.Queries())
	}

	// The plans: the big supplier's chip page, its search under the chip, the Toko figures under the chip, its Toko list.
	for _, c := range []perfSpCase{cases[6], cases[9], cases[4], cases[2]} {
		probe.Reset()

		_, err := c.run()
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, raw, q.SQL)
		}
	}
}

// perfChipControl binds each page statement's arrays, together, to `SELECT length($1) + …` — the parameters' own cost.
func perfChipControl(t *testing.T, raw *gorm.DB, name string, queries []san_perf.Query) {
	t.Helper()

	for _, q := range queries {
		if perfSpStep(q.SQL) != "page" {
			continue
		}

		var arrays []any

		size := 0
		rest := q.SQL

		for {
			at := strings.Index(rest, "'{")
			if at < 0 {
				break
			}

			end := strings.Index(rest[at:], "}'")
			arrays = append(arrays, rest[at+1:at+end+1])
			size += end
			rest = rest[at+end+2:]
		}

		if len(arrays) == 0 {
			continue
		}

		sum := strings.TrimSuffix(strings.Repeat("length(?) + ", len(arrays)), " + ")

		var walls []time.Duration

		for range 5 {
			start := time.Now()

			var n int

			err := raw.Raw("SELECT "+sum, arrays...).Scan(&n).Error
			if err != nil {
				t.Fatal(err)
			}

			walls = append(walls, time.Since(start))
		}

		t.Logf("control (%s): the page binds %d arrays, %d bytes — SELECT of their lengths %.1f ms (median of 5)",
			name, len(arrays), size, float64(san_perf.Median(walls).Microseconds())/1000)
	}
}
