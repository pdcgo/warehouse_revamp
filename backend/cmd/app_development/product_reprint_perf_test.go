//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for THE REPRINT OF CHANGED CODES (backlog #151): inventory's
// ProductReprintList (product_service's page of waits with each one's live code and former code, then this warehouse's
// shelf spots), the *Cetak ulang kode (N)* count riding on WarehouseStockList, ProductReprintRecord (the teams' locks, the
// live codes, ONE delete of the waits, ONE delete of the tag links) and a transfer arrival's insert.
//
// ONE seed, at the brief's volume: a warehouse with 5 000 waiting products on 2 shelf spots each (10 000 labels in all),
// another warehouse with 5 000 others waiting, 100 000 background products in eight other teams (half of them on a shelf
// in the warehouse at 0 or more), one `code_changed` line per product (two for a fifth of them), the tag on every waiting
// product. Timed: the list's first page (200 products, 400 labels) and a deep one; the count; the record of 50 and of 500
// products at once; an arrival of 500. Their SELECTs EXPLAINed.
//
// THE STATEMENT COUNT MUST NOT MOVE WITH THE PRODUCTS — the record of 500 runs as many statements as the record of 50.
//
//	go test -tags perfaudit -p 1 -count=1 -timeout 15m -run 'TestPerf_ProductReprint' -v ./backend/cmd/app_development/
package main

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

const (
	perfRpWarehouse uint64 = 9_151_901
	perfRpOther     uint64 = 9_151_902
	perfRpTeam      uint64 = 9_151_910
)

func perfRpSeed(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	exec := func(sql string, args ...any) {
		t.Helper()

		err := quiet.Exec(sql, args...).Error
		if err != nil {
			t.Fatalf("%s: %v", sql[:min(len(sql), 80)], err)
		}
	}

	// The waiting team's 10 000 products (5 000 wait here, 5 000 at the other warehouse) and the background.
	exec(`INSERT INTO products (team_id, product_code, name, category_id)
		SELECT ?, 'PRP-XYZ-' || lpad(g::text, 6, '0'), 'Tunggu ' || g, 1 FROM generate_series(1, 10000) g`, perfRpTeam)
	exec(`INSERT INTO products (team_id, product_code, name, category_id)
		SELECT 9151920 + g % 8, 'PRP-BG' || (g % 8) || '-' || lpad(g::text, 7, '0'), 'Latar ' || g, 1 FROM generate_series(1, 100000) g`)

	exec(`INSERT INTO product_logs (product_id, kind, old_code, new_code)
		SELECT id, 'code_changed', replace(product_code, 'XYZ', 'ABC'), product_code FROM products WHERE product_code LIKE 'PRP-%'`)
	exec(`INSERT INTO product_logs (product_id, kind, old_code, new_code)
		SELECT id, 'code_changed', replace(product_code, 'XYZ', 'QWE'), product_code FROM products WHERE product_code LIKE 'PRP-%' AND id % 5 = 0`)

	exec(`INSERT INTO product_reprint_waits (product_id, warehouse_id)
		SELECT id, CASE WHEN row_number() OVER (ORDER BY id) <= 5000 THEN CAST(? AS bigint) ELSE CAST(? AS bigint) END
		FROM products WHERE team_id = ?`, perfRpWarehouse, perfRpOther, perfRpTeam)
	exec(`INSERT INTO product_tag_links (product_id, tag_id, added_by_user_id, added_by_is_override, added_at)
		SELECT p.id, g.id, 0, false, NOW() FROM products p, product_tags g WHERE p.team_id = ? AND g.app_task = ?`,
		perfRpTeam, product_v1.AppTaskReprintCode)

	for _, w := range []uint64{perfRpWarehouse, perfRpOther} {
		exec(`INSERT INTO placements (warehouse_id, code, name) SELECT ?, 'prp-' || lpad(g::text, 3, '0'), 'Rak' FROM generate_series(1, 200) g`, w)
	}

	// Two spots per waiting product, in its own warehouse; half the background on a spot in the warehouse.
	exec(`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		SELECT p.team_id, w.warehouse_id, p.id, pl.id, 1 + p.id % 30
		FROM products p
		JOIN product_reprint_waits w ON w.product_id = p.id
		JOIN LATERAL (SELECT id FROM placements WHERE warehouse_id = w.warehouse_id AND code IN
			('prp-' || lpad((1 + p.id % 200)::text, 3, '0'), 'prp-' || lpad((1 + (p.id + 7) % 200)::text, 3, '0'))) pl ON true
		WHERE p.team_id = ?`, perfRpTeam)
	exec(`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		SELECT p.team_id, ?, p.id, (SELECT id FROM placements WHERE warehouse_id = ? AND code = 'prp-' || lpad((1 + p.id % 200)::text, 3, '0')), p.id % 3
		FROM products p WHERE p.product_code LIKE 'PRP-BG%' AND p.id % 2 = 0`, perfRpWarehouse, perfRpWarehouse)

	for _, tbl := range []string{"products", "product_logs", "product_reprint_waits", "product_tag_links", "product_placements", "placements"} {
		exec("ANALYZE " + tbl)
	}
}

func TestPerf_ProductReprint(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfRpSeed(t, db)

	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	reader := NewInventoryProductReader(products)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, reader, nil, nil, nil, nil)
	ctx := asWarehouseStaff(perfRpWarehouse)

	explainSelects := func(queries []san_perf.Query) {
		for _, q := range queries {
			sql := strings.TrimSpace(q.SQL)
			if !strings.HasPrefix(sql, "SELECT") || strings.Contains(sql, "pg_advisory_xact_lock") {
				continue
			}

			san_perf.Explain(t, db, sql)
		}
	}

	// THE LIST — the first page and a deep one.
	var firstPage *inventoryv1.ProductReprintListResponse

	// Page 1 twice — the first read of a fresh seed is cold; the second is the one a person reads.
	for round, page := range []uint32{1, 1, 20} {
		probe.Reset()

		wall, inDB := probe.Measure(func() {
			res, err := inventory.ProductReprintList(ctx, connect.NewRequest(&inventoryv1.ProductReprintListRequest{
				WarehouseId: perfRpWarehouse, Page: &commonv1.CommonPagination{Page: page, Limit: 200},
			}))
			if err != nil {
				t.Fatal(err)
			}

			if page == 1 {
				firstPage = res.Msg
			}
		})

		t.Logf("ProductReprintList page %d, round %d (200 products): wall %s, db %s, %d queries", page, round, wall.Round(time.Microsecond),
			inDB.Round(time.Microsecond), probe.Count())

		queries := probe.Queries()
		probe.Report(t, fmt.Sprintf("ProductReprintList page %d", page))

		if round == 1 {
			explainSelects(queries)
		}
	}

	labels := 0
	for _, item := range firstPage.GetItems() {
		labels += len(item.GetLabels())
	}

	if len(firstPage.GetItems()) != 200 || labels != 400 || firstPage.GetPageInfo().GetTotalItems() != 5000 {
		t.Fatalf("page 1 = %d products, %d labels, total %d — want 200, 400 of 5 000", len(firstPage.GetItems()), labels,
			firstPage.GetPageInfo().GetTotalItems())
	}

	// THE COUNT on the warehouse's Products list.
	probe.Reset()

	wall, inDB := probe.Measure(func() {
		n, err := reader.ReprintWaitingCount(ctx, perfRpWarehouse)
		if err != nil || n != 5000 {
			t.Fatalf("count = %d (%v), want 5 000", n, err)
		}
	})
	t.Logf("ReprintWaitingCount (5 000 waiting): wall %s, db %s, %d queries", wall.Round(time.Microsecond), inDB.Round(time.Microsecond), probe.Count())
	explainSelects(probe.Queries())

	// THE RECORD — 50 and 500 products at once, every one printed with its live code: cleared and untagged.
	ids := make([]uint64, 0, 550)

	err := db.Session(&gorm.Session{Logger: logger.Discard}).
		Raw(`SELECT product_id FROM product_reprint_waits WHERE warehouse_id = ? ORDER BY product_id DESC LIMIT 550`, perfRpWarehouse).
		Scan(&ids).Error
	if err != nil {
		t.Fatal(err)
	}

	codes := map[uint64]string{}

	var rows []struct {
		ID          uint64
		ProductCode string
	}

	err = db.Session(&gorm.Session{Logger: logger.Discard}).Raw("SELECT id, product_code FROM products WHERE id IN ?", ids).Scan(&rows).Error
	if err != nil {
		t.Fatal(err)
	}

	for _, r := range rows {
		codes[r.ID] = r.ProductCode
	}

	statements := map[int]int{}

	for _, c := range []struct{ from, n int }{{0, 50}, {50, 500}} {
		items := make([]*inventoryv1.ProductReprintPrinted, 0, c.n)
		for _, id := range ids[c.from : c.from+c.n] {
			items = append(items, &inventoryv1.ProductReprintPrinted{ProductId: id, ProductCode: codes[id]})
		}

		probe.Reset()

		var res *connect.Response[inventoryv1.ProductReprintRecordResponse]

		wall, inDB := probe.Measure(func() {
			var recErr error

			res, recErr = inventory.ProductReprintRecord(ctx, connect.NewRequest(&inventoryv1.ProductReprintRecordRequest{
				WarehouseId: perfRpWarehouse, Items: items,
			}))
			if recErr != nil {
				t.Fatal(recErr)
			}
		})

		if len(res.Msg.GetClearedIds()) != c.n || len(res.Msg.GetUntaggedIds()) != c.n {
			t.Fatalf("record of %d: cleared %d, untagged %d", c.n, len(res.Msg.GetClearedIds()), len(res.Msg.GetUntaggedIds()))
		}

		statements[c.n] = probe.Count()
		t.Logf("ProductReprintRecord of %d products: wall %s, db %s, %d queries", c.n, wall.Round(time.Microsecond),
			inDB.Round(time.Microsecond), probe.Count())

		queries := probe.Queries()
		probe.Report(t, fmt.Sprintf("ProductReprintRecord %d", c.n))

		if c.n == 500 {
			explainSelects(queries)
		}

		if wall > time.Second {
			t.Logf("🟡 HEAVY: the record of %d took %s", c.n, wall.Round(time.Millisecond))
		}
	}

	if statements[50] != statements[500] {
		t.Errorf("the record of 500 ran %d statements, of 50 %d — the count moved with the products (a loop?)", statements[500], statements[50])
	}

	// AN ARRIVAL of 500 products at the other warehouse (a transfer accept's call, on its transaction).
	arriving := make([]uint64, 0, 500)

	err = db.Session(&gorm.Session{Logger: logger.Discard}).
		Raw(`SELECT product_id FROM product_reprint_waits WHERE warehouse_id = ? ORDER BY product_id LIMIT 500`, perfRpWarehouse).
		Scan(&arriving).Error
	if err != nil {
		t.Fatal(err)
	}

	probe.Reset()

	wall, inDB = probe.Measure(func() {
		arrErr := db.Transaction(func(tx *gorm.DB) error {
			return reader.ReprintArrivals(ctx, tx, perfRpOther, arriving)
		})
		if arrErr != nil {
			t.Fatal(arrErr)
		}
	})
	t.Logf("ReprintArrivals of 500 products: wall %s, db %s, %d queries", wall.Round(time.Microsecond), inDB.Round(time.Microsecond), probe.Count())
	probe.Report(t, "ReprintArrivals 500")
}
