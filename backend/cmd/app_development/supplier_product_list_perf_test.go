//go:build perfaudit

// Performance audit for the Produk tab — SupplierProductList and SupplierProductExport (the audit-rpc-performance skill),
// measured through the REAL wiring: supplier_service pages its links, product_service names them and searches among
// them (supplierProductCatalog), inventory fills their figures (supplierGoodsReader → SupplierStoreProductGoods), on one
// probed database.
//
// Volume: 2 000 suppliers kept by 10 selling teams, two stores each (the big one ten); 30 000 products; 40 000 links —
// the big supplier 4 000 (10 %), every other ≈ 18, one in five bought with no store; 100 000 batches (two or three per
// link, over 8 warehouses, two in five emptied); 300 000 `order` rows on batch_logs.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierProductList -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

const perfSpTeam uint64 = 9_550_001

func perfSpVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO suppliers (team_id, name, contact, address, description, created_at, updated_at)
		 SELECT 9550001 + g % 10, 'PSP Pemasok ' || lpad(g::text, 4, '0'), '', '', 'seeded for the perf audit', NOW(), NOW()
		 FROM generate_series(1, 2000) g`,

		// Two stores a supplier; the big one (the first) ten.
		`INSERT INTO supplier_channels (supplier_id, channel_type, name, uri, description, created_at, updated_at)
		 SELECT s.id, (ARRAY['shopee','tokopedia','tiktok','lazada','other'])[1 + n % 5], 'PSP Toko ' || s.id || '-' || n, '', '', NOW(), NOW()
		 FROM suppliers s CROSS JOIN generate_series(1, 10) n
		 WHERE s.name LIKE 'PSP %' AND (n <= 2 OR s.name = 'PSP Pemasok 0001')`,

		`INSERT INTO products (team_id, product_code, name, created_at, updated_at)
		 SELECT 9550001 + g % 10, 'PSP-' || g,
		        (ARRAY['Kain','Benang','Kancing','Resleting','Batik','Kaos'])[1 + g % 6] || ' ' ||
		        (ARRAY['Katun','Rayon','Linen','Polyester'])[1 + (g / 6) % 4] || ' ' || g, NOW(), NOW()
		 FROM generate_series(1, 30000) g`,

		// 40 000 links: g ≤ 4 000 the big supplier, the rest round the other 1 999. One in five with no store.
		`WITH s AS (SELECT array_agg(id ORDER BY name) AS ids FROM suppliers WHERE name LIKE 'PSP %'),
		 p AS (SELECT MIN(id) AS lo FROM products WHERE product_code LIKE 'PSP-%'),
		 g AS (
		   SELECT g, CASE WHEN g <= 4000 THEN s.ids[1] ELSE s.ids[2 + (g - 4001) % 1999] END AS supplier_id,
		          p.lo + (g * 7) % 30000 AS product_id
		   FROM generate_series(1, 40000) g, s, p
		 )
		 INSERT INTO supplier_channel_products (team_id, supplier_id, channel_id, product_id, first_restocked_at,
		                                        last_restocked_at, last_restock_id, created_at, updated_at)
		 SELECT pr.team_id, g.supplier_id,
		        CASE WHEN g.g % 5 = 0 THEN NULL ELSE
		          (SELECT c.id FROM supplier_channels c WHERE c.supplier_id = g.supplier_id ORDER BY c.id
		           OFFSET (g.g % CASE WHEN g.g <= 4000 THEN 10 ELSE 2 END) LIMIT 1) END,
		        g.product_id,
		        NOW() - (g.g % 365) * INTERVAL '1 day' - (g.g % 1440) * INTERVAL '1 minute' - (g.g % 90) * INTERVAL '1 day',
		        NOW() - (g.g % 365) * INTERVAL '1 day' - (g.g % 1440) * INTERVAL '1 minute',
		        g.g, NOW(), NOW()
		 FROM g JOIN products pr ON pr.id = g.product_id`,

		// 100 000 batches: two per link, a third for every other link — each carrying the link's supplier, store and product.
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		   SELECT 9551001 + g % 8, 9550001 + g % 10, 'restock', NOW() - g * INTERVAL '5 minutes', NOW()
		   FROM generate_series(1, 25000) g
		   RETURNING id
		 ),
		 tx AS (SELECT array_agg(id ORDER BY id) AS ids FROM t),
		 l AS (
		   SELECT l.*, row_number() OVER (ORDER BY l.id) AS rn
		   FROM supplier_channel_products l JOIN suppliers s ON s.id = l.supplier_id
		   WHERE s.name LIKE 'PSP %'
		 )
		 INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		 SELECT 9551001 + (l.rn + n) % 8, l.team_id, l.product_id, tx.ids[1 + (l.rn * 3 + n) % 25000], 10000,
		        CASE WHEN (l.rn + n) % 5 < 2 THEN 0 ELSE 1 + (l.rn + n) % 12 END,
		        CASE WHEN (l.rn + n) % 5 < 2 THEN 0 ELSE (1 + (l.rn + n) % 12) * 10000 END,
		        20, 200000, l.supplier_id, COALESCE(l.channel_id, 0), l.last_restocked_at, NOW()
		 FROM l CROSS JOIN tx CROSS JOIN generate_series(1, 3) n
		 WHERE n <= 2 OR l.rn % 2 = 0`,

		`WITH bounds AS (
		   SELECT MIN(b.id) AS lo, MAX(b.id) - MIN(b.id) AS span
		   FROM batches b WHERE b.warehouse_id BETWEEN 9551001 AND 9551008
		 ),
		 t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, is_rollback, created_at, updated_at)
		   SELECT 9551001, 9550001, 'order', g % 50 = 0, NOW() - g * INTERVAL '1 minute', NOW()
		   FROM generate_series(1, 150000) g
		   RETURNING id, created_at
		 )
		 INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		 SELECT 9551001, 9550001, bounds.lo + ((t.id * 7919 + n * 104729) % bounds.span), t.id, 'order', -1, -10000,
		        1, 10000, 10000, '', 1, t.created_at
		 FROM t CROSS JOIN bounds CROSS JOIN generate_series(1, 2) n`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("produk tab seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"suppliers", "supplier_channels", "products", "supplier_channel_products",
		"inventory_transactions", "batches", "batch_logs"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// perfSpStep names a statement by what it does, for the summary table — most specific first.
func perfSpStep(sql string) string {
	switch {
	// The Gudang terkait chip's sets (supplier_warehouse_chip_perf_test.go) — the pairs read first: it also names a store.
	case strings.Contains(sql, "DISTINCT b.supplier_channel_id AS store_id"):
		return "pairs at W"
	case strings.Contains(sql, "DISTINCT b.supplier_channel_id"):
		return "stores at W"
	case strings.Contains(sql, "SUM(b.stock_count) AS ready"):
		return "goods ready"
	case strings.Contains(sql, "COUNT(DISTINCT b.transaction_id)"):
		return "goods restocks"
	case strings.Contains(sql, "per_order") && !strings.Contains(sql, "page_batches"):
		return "goods sold"
	case strings.Contains(sql, `FROM "supplier_channels"`) && !strings.Contains(sql, "count(*)"):
		return "stores page"
	case strings.Contains(sql, "page_batches"):
		return "figures"
	case strings.Contains(sql, "COUNT(*) OVER ()"):
		return "page"
	case strings.Contains(sql, "DISTINCT l.product_id"):
		return "candidates"
	case strings.Contains(sql, `FROM "products"`) && strings.Contains(sql, "ILIKE"):
		return "search"
	case strings.Contains(sql, `FROM "products"`):
		return "names"
	case strings.Contains(sql, "count(*)"):
		return "count"
	case strings.Contains(sql, `FROM "suppliers"`):
		return "supplier"
	}

	return "other"
}

type perfSpCase struct {
	name string
	run  func() (string, error)
}

func perfSpMeasure(t *testing.T, probe *san_perf.Probe, summary *strings.Builder, c perfSpCase) {
	t.Helper()

	shape, err := c.run() // warm-up: schema reflection and the pool are not the read's cost
	if err != nil {
		t.Fatalf("%s: %v", c.name, err)
	}

	walls := make([]time.Duration, 0, 5)
	steps := map[int][]time.Duration{}
	labels := map[int]string{}

	for range 5 {
		probe.Reset()

		wall, _ := probe.Measure(func() {
			_, err = c.run()
		})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		walls = append(walls, wall)

		for i, q := range probe.Queries() {
			steps[i] = append(steps[i], q.Duration)
			labels[i] = perfSpStep(q.SQL)
		}
	}

	keys := make([]int, 0, len(steps))
	for i := range steps {
		keys = append(keys, i)
	}

	sort.Ints(keys)

	parts := make([]string, 0, len(keys))
	for _, i := range keys {
		if len(keys) > 12 && i >= 6 {
			continue // an export's steps repeat — the first two steps say it
		}

		parts = append(parts, fmt.Sprintf("%s %.1f", labels[i], float64(san_perf.Median(steps[i]).Microseconds())/1000))
	}

	fmt.Fprintf(summary, "| %s | %s | %d | %s | %.1f ms |\n", c.name, shape, len(keys), strings.Join(parts, " · "),
		float64(san_perf.Median(walls).Microseconds())/1000)
}

// perfSpStore is the export's ExportStore: the file is thrown away, the teams named by id.
type perfSpStore struct{}

func (perfSpStore) Store(context.Context, uint64, string, []byte) (string, error) {
	return "https://files.example/perf.xlsx", nil
}

func (perfSpStore) ProductNames(context.Context, uint64, []uint64) (map[uint64]supplier_v1.ExportProduct, error) {
	return map[uint64]supplier_v1.ExportProduct{}, nil
}

func (perfSpStore) TeamNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	for _, id := range ids {
		out[id] = fmt.Sprintf("Tim %d", id)
	}

	return out, nil
}

func TestPerf_SupplierProductList(t *testing.T) {
	raw := san_testdb.DB(t)

	// A run is only worth quoting on clean tables: a killed run's seed sits as dead rows (revamp-build-passes).
	for _, table := range []string{"supplier_channel_products", "products", "batches", "batch_logs"} {
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

	var bigStore uint64

	// The big supplier's second store — the first holds only every tenth link, and those all fell to "no store".
	err = raw.Raw(`SELECT id FROM supplier_channels WHERE supplier_id = ? ORDER BY id OFFSET 1 LIMIT 1`, ids.Big).Scan(&bigStore).Error
	if err != nil {
		t.Fatal(err)
	}

	db, probe := san_perf.Wrap(raw)
	ctx := context.Background()
	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil), db)
	catalog := NewSupplierProductCatalog(product_v1.NewService(db, nil, nil, nil, nil))
	svc := supplier_v1.NewService(db, nil, nil, reader, perfSpStore{}, catalog)

	list := func(filter *supplierv1.SupplierProductListFilter, pageNo, limit uint32) func() (string, error) {
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

	export := func(filter *supplierv1.SupplierProductListFilter) func() (string, error) {
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

	big := func(f *supplierv1.SupplierProductListFilter) *supplierv1.SupplierProductListFilter {
		f.SupplierId = ids.Big
		return f
	}

	cases := []perfSpCase{
		{"typical supplier · page 1 × 20", list(&supplierv1.SupplierProductListFilter{SupplierId: ids.Typical}, 1, 20)},
		{"typical supplier · q=kain", list(&supplierv1.SupplierProductListFilter{SupplierId: ids.Typical, Q: "kain"}, 1, 20)},
		{"big supplier · page 1 × 20", list(big(&supplierv1.SupplierProductListFilter{}), 1, 20)},
		{"big supplier · page 1 × 50", list(big(&supplierv1.SupplierProductListFilter{}), 1, 50)},
		{"big supplier · page 100 × 20", list(big(&supplierv1.SupplierProductListFilter{}), 100, 20)},
		{"big supplier · q=katun (≈ a quarter)", list(big(&supplierv1.SupplierProductListFilter{Q: "katun"}), 1, 20)},
		{"big supplier · q=PSP-1001 (one SKU)", list(big(&supplierv1.SupplierProductListFilter{Q: "PSP-1001"}), 1, 20)},
		{"big supplier · q=zzz (none)", list(big(&supplierv1.SupplierProductListFilter{Q: "zzz"}), 1, 20)},
		{"big supplier · one store", list(big(&supplierv1.SupplierProductListFilter{StoreId: bigStore}), 1, 20)},
		{"big supplier · no store", list(big(&supplierv1.SupplierProductListFilter{NoStore: true}), 1, 20)},
		{"big supplier · one team", list(big(&supplierv1.SupplierProductListFilter{ProductTeamId: perfSpTeam + 3}), 1, 20)},
		{"export: typical supplier", export(&supplierv1.SupplierProductListFilter{SupplierId: ids.Typical})},
		{"export: big supplier (20 steps)", export(big(&supplierv1.SupplierProductListFilter{}))},
	}

	var summary strings.Builder

	summary.WriteString("\n| case | answer | queries | step medians, ms | wall median |\n|---|---|---|---|---|\n")

	for _, c := range cases {
		perfSpMeasure(t, probe, &summary, c)
	}

	t.Log(summary.String())

	// THE CONTROL: the candidate array the big supplier's search binds, bound to a query that does nothing with it — this
	// host's loopback cost of a big parameter, not the search's (revamp-build-passes: the ≈ 25–30 KB stall).
	probe.Reset()

	_, err = cases[5].run()
	if err != nil {
		t.Fatalf("control: %v", err)
	}

	for _, q := range probe.Queries() {
		if perfSpStep(q.SQL) != "search" {
			continue
		}

		payload := q.SQL[strings.Index(q.SQL, "'{"):]
		payload = payload[1 : strings.Index(payload, "}'")+1]

		var walls []time.Duration

		for range 5 {
			start := time.Now()

			var n int

			err = raw.Raw("SELECT length(?)", payload).Scan(&n).Error
			if err != nil {
				t.Fatal(err)
			}

			walls = append(walls, time.Since(start))
		}

		t.Logf("control: the search's candidate array is %d bytes — SELECT length($1) of it %.1f ms (median of 5)",
			len(payload), float64(san_perf.Median(walls).Microseconds())/1000)
	}

	// THE INDEX PROBE (a-pure-index-is-added-without-asking): the figures read finds a page's batches by supplier and
	// store (batches_supplier_idx), then filters by product — at the big supplier ≈ 1 100–1 500 rows per pair. A
	// (product, supplier, store) index finds each pair's batches directly — but a CACHED GENERIC plan (pgx prepares every
	// statement; Postgres goes generic after five runs) weighs the two indexes as a tie (cost 8.31 vs 8.44) and picks
	// either by the statistics' sample. Built in this test's transaction, rolled back with it.
	err = raw.Exec(`CREATE INDEX perf_batches_product_supplier_idx ON batches (product_id, supplier_id, supplier_channel_id)`).Error
	if err != nil {
		t.Fatal(err)
	}

	err = raw.Exec(`ANALYZE batches`).Error
	if err != nil {
		t.Fatal(err)
	}

	var indexed strings.Builder

	indexed.WriteString("\nwith (product_id, supplier_id, supplier_channel_id) on batches:\n| case | answer | queries | step medians, ms | wall median |\n|---|---|---|---|---|\n")

	for _, c := range []perfSpCase{cases[0], cases[2], cases[3], cases[4], cases[9], cases[12]} {
		perfSpMeasure(t, probe, &indexed, c)
	}

	t.Log(indexed.String())

	// The plans of the big supplier's page 1 and its search.
	for _, c := range []perfSpCase{cases[2], cases[5]} {
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
