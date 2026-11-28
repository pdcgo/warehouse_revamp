//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the PRODUCT TAGS (backlog #147,
// the-team-code-and-product-tags-prototype-is-accepted: both Products lists' Tag filter, ANY of; every row's Tag column):
//
//   - ProductList with `tag_ids` over 100 000 products in five teams — team 2 holds 20 000 — by the default order (newest
//     first) and by name, each pick of tags: none, a rare one (1 in 503 products), a middling one (1 in 53), a common one
//     (1 in 7), the app's (1 in 97, a reprint wave) and rare-or-common;
//
//   - SearchAmong — the warehouse's Products list's half — over a held set of 3 000 and of 6 000 ids, with the same picks
//     and the rows' tags;
//
//   - ProductTagsByIds — the warehouse product page — 200 ids;
//
//   - each measured WITHOUT and WITH 00010's `product_tag_links_tag_idx` (tag_id, product_id), in ONE process on ONE seed,
//     and under a forced generic plan too. The plain list's page also reads its tags now (one statement per page),
//     logged with its query count.
//
//     go test -tags perfaudit -p 1 -count=1 -run 'TestPerf_ProductTags' -v ./backend/services/product_service/product_v1/
package product_v1_test

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func TestPerf_ProductTags(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const products = 100_000

	rows := make([]product_service_models.Product, 0, products)
	for i := range products {
		rows = append(rows, product_service_models.Product{
			TeamID:      2 + uint64(i%5),
			ProductCode: fmt.Sprintf("PTG-%07d", i),
			Name:        fmt.Sprintf("Produk %07d", (i*7919)%products),
			Archived:    i%10 == 3,
		})
	}

	san_perf.SeedRows(t, quiet, &rows)

	seedTag := func(name, kind string) uint64 {
		tag := product_service_models.ProductTag{Name: name, Type: kind}

		err := quiet.Create(&tag).Error
		if err != nil {
			t.Fatal(err)
		}

		return tag.ID
	}

	common := seedTag("perf-Umum", "custom")
	middling := seedTag("perf-Sedang", "custom")
	rare := seedTag("perf-Langka", "system")

	var app product_service_models.ProductTag

	err := quiet.Where("app_task = ?", product_v1.AppTaskReprintCode).Take(&app).Error
	if err != nil {
		t.Fatal(err)
	}

	link := func(tag uint64, where string) string {
		return `INSERT INTO product_tag_links (product_id, tag_id) SELECT id, ` + strconv.FormatUint(tag, 10) +
			` FROM products WHERE product_code LIKE 'PTG-%' AND ` + where
	}

	for _, sql := range []string{
		link(common, `id % 7 = 0`),
		link(middling, `id % 53 = 3`),
		link(rare, `id % 503 = 7`),
		link(app.ID, `id % 97 = 11`),
		`ANALYZE products`,
		`ANALYZE product_tag_links`,
	} {
		err = quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	var team2 []uint64

	err = quiet.Model(&product_service_models.Product{}).
		Where("team_id = 2 AND product_code LIKE 'PTG-%'").
		Order("id").
		Pluck("id", &team2).
		Error
	if err != nil {
		t.Fatal(err)
	}

	for _, tag := range []uint64{common, middling, rare, app.ID} {
		var n int64

		quiet.Raw(`SELECT count(*) FROM product_tag_links l JOIN products p ON p.id = l.product_id
			WHERE l.tag_id = ? AND p.team_id = 2 AND NOT p.archived`, tag).Scan(&n)

		t.Logf("team 2's live list holds %d products carrying tag %d", n, tag)
	}

	// The held sets of two warehouses — every team's products, a spread across the catalogue.
	var all []uint64

	err = quiet.Model(&product_service_models.Product{}).Where("product_code LIKE 'PTG-%'").Order("id").Pluck("id", &all).Error
	if err != nil {
		t.Fatal(err)
	}

	heldSmall := make([]uint64, 0, 3_000)
	heldBig := make([]uint64, 0, 6_000)

	for i, id := range all {
		if i%33 == 0 && len(heldSmall) < 3_000 {
			heldSmall = append(heldSmall, id)
		}

		if i%16 == 0 && len(heldBig) < 6_000 {
			heldBig = append(heldBig, id)
		}
	}

	svc := product_v1.NewService(db, nil, nil, nil, nil)
	ctx := ptCtx(ptSeller)

	byName := &productv1.ProductListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &productv1.ProductListFilterSort_Product{Product: productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME},
	}

	list := func(tags []uint64, sort *productv1.ProductListFilterSort) func() {
		return func() {
			_, listErr := svc.ProductList(ctx, connect.NewRequest(&productv1.ProductListRequest{
				TeamId: 2, Filter: &productv1.ProductListFilter{TagIds: tags}, Sort: sort,
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if listErr != nil {
				t.Fatalf("ProductList: %v", listErr)
			}
		}
	}

	among := func(ids, tags []uint64) func() {
		return func() {
			_, _, searchErr := svc.SearchAmong(ctx, product_v1.ProductSearchAmong{IDs: ids, TagIDs: tags, WithTags: true, Limit: 20})
			if searchErr != nil {
				t.Fatalf("SearchAmong: %v", searchErr)
			}
		}
	}

	tagsOf := func() {
		_, byIdsErr := svc.ProductTagsByIds(ctx, connect.NewRequest(&productv1.ProductTagsByIdsRequest{TeamId: 2, ProductIds: team2[:200]}))
		if byIdsErr != nil {
			t.Fatalf("ProductTagsByIds: %v", byIdsErr)
		}
	}

	picks := []struct {
		name string
		tags []uint64
	}{
		{"no tag", nil},
		{"rare", []uint64{rare}},
		{"middling", []uint64{middling}},
		{"common", []uint64{common}},
		{"app", []uint64{app.ID}},
		{"rare or common", []uint64{rare, common}},
	}

	timed := func(label string, call func()) {
		call() // warm-up

		walls := make([]time.Duration, 0, 7)

		for range 7 {
			probe.Reset()
			wall, _ := probe.Measure(call)
			walls = append(walls, wall)
		}

		t.Logf("%s MEDIAN wall %v, queries %d", label, san_perf.Median(walls), probe.Count())
	}

	explain := func(label string, call func(), marker string) {
		probe.Reset()
		call()

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, marker) && !strings.Contains(q.SQL, "SAVEPOINT") && !strings.Contains(q.SQL, "RELEASE") {
				t.Logf("%s · plan:\n%s", label, san_perf.Explain(t, db, q.SQL))
			}
		}
	}

	measure := func(label string) {
		for _, pick := range picks {
			timed(fmt.Sprintf("%s · ProductList newest (%s)", label, pick.name), list(pick.tags, nil))
			timed(fmt.Sprintf("%s · ProductList by name (%s)", label, pick.name), list(pick.tags, byName))
			timed(fmt.Sprintf("%s · SearchAmong 3 000 held (%s)", label, pick.name), among(heldSmall, pick.tags))
			timed(fmt.Sprintf("%s · SearchAmong 6 000 held (%s)", label, pick.name), among(heldBig, pick.tags))
		}

		timed(label+" · ProductTagsByIds 200", tagsOf)

		for _, pick := range picks[1:] {
			if pick.name != "rare" && pick.name != "common" {
				continue
			}

			explain(fmt.Sprintf("%s · ProductList newest · %s", label, pick.name), list(pick.tags, nil), "product_tag_links l")
			explain(fmt.Sprintf("%s · SearchAmong 6 000 · %s", label, pick.name), among(heldBig, pick.tags), "product_tag_links l")
		}

		// The page's tags (productTagsOf) — the one statement every list page now adds.
		explain(label+" · the page's tags", list(nil, nil), "FROM \"product_tag_links\"")
	}

	generic := func(label string) {
		setErr := db.Exec(`SET LOCAL plan_cache_mode = force_generic_plan`).Error
		if setErr != nil {
			t.Fatal(setErr)
		}

		measure(label + " · generic plan")

		setErr = db.Exec(`SET LOCAL plan_cache_mode = auto`).Error
		if setErr != nil {
			t.Fatal(setErr)
		}
	}

	// The loopback's own cost of the big id array — a control, so a 6 000-id search is not called slow for its parameter.
	for _, ids := range [][]uint64{heldSmall, heldBig} {
		param := "{" + strings.Trim(strings.Join(strings.Fields(fmt.Sprint(ids)), ","), "[]") + "}"

		timed(fmt.Sprintf("control · SELECT length($1) of %d ids (%d bytes)", len(ids), len(param)), func() {
			var n int

			quiet.Raw(`SELECT length(?)`, param).Scan(&n)
		})
	}

	// Without the tag-side index first — dropped inside the test's transaction, so it comes back with the rollback.
	for _, sql := range []string{`DROP INDEX product_tag_links_tag_idx`, `ANALYZE product_tag_links`} {
		err = db.Exec(sql).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	measure("WITHOUT product_tag_links_tag_idx")
	generic("WITHOUT product_tag_links_tag_idx")

	for _, sql := range []string{`CREATE INDEX product_tag_links_tag_idx ON product_tag_links (tag_id, product_id)`, `ANALYZE product_tag_links`} {
		err = db.Exec(sql).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	measure("WITH product_tag_links_tag_idx")
	generic("WITH product_tag_links_tag_idx")
}
