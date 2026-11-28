//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the FORMER CODES (backlog #152, #141 P4 —
// a-team-code-change-recomposes-its-product-codes, its 🔄 *an old sticker scanned before the reprint*, owner Q1 "A"):
//
//   - ProductList's `q` (the seller's Products list) over 100 000 products in five teams — team 2 holds 20 000 — with
//     50 000 `code_changed` history lines (half the catalogue changed code once): a term that IS a former code, a live
//     code typed whole, a piece of a name, and a term matching nothing (the former-code branch still asks the history);
//
//   - SearchAmong (the warehouse's Products list and picker) over a held set of 6 000 ids, the same terms;
//
//   - ProductCodesByIds — the pick pages' one read — 200 ids;
//
//   - each WITHOUT and WITH 00012's `product_logs_old_code_idx` (lower(old_code)), in ONE process on ONE seed, and under a
//     forced generic plan too (pgx prepares every statement);
//
//   - the table's one WRITER — the team code change (RecomposeTeamCodes, one history line per product) — over team 2's
//     20 000 products, timed with and without the index, alternating, in the same process.
//
//     go test -tags perfaudit -p 1 -count=1 -timeout 15m -run 'TestPerf_FormerCodes' -v ./backend/services/product_service/product_v1/
package product_v1_test

import (
	"context"
	"errors"
	"fmt"
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

func TestPerf_FormerCodes(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const products = 100_000

	rows := make([]product_service_models.Product, 0, products)
	for i := range products {
		team := 2 + uint64(i%5)
		// Team 2's codes sit under one team code (PFA-…), as a real team's do — the recompose below moves them all.
		code := fmt.Sprintf("PFX%d-%07d", team, i)
		if team == 2 {
			code = fmt.Sprintf("PFA-%07d", i)
		}

		rows = append(rows, product_service_models.Product{
			TeamID:      team,
			ProductCode: code,
			Name:        fmt.Sprintf("Produk %07d", (i*7919)%products),
			Archived:    i%10 == 3,
		})
	}

	san_perf.SeedRows(t, quiet, &rows)

	// Half the catalogue changed code once: its old code was `OLD<its code now>`.
	for _, sql := range []string{
		`INSERT INTO product_logs (product_id, kind, old_code, new_code)
			SELECT id, 'code_changed', 'OLD' || product_code, product_code FROM products
			WHERE (product_code LIKE 'PFA-%' OR product_code LIKE 'PFX%') AND id % 2 = 0`,
		`ANALYZE products`,
		`ANALYZE product_logs`,
	} {
		err := quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	var logs int64

	quiet.Raw(`SELECT count(*) FROM product_logs WHERE kind = 'code_changed'`).Scan(&logs)
	t.Logf("seeded %d products, %d code_changed lines", products, logs)

	// A live product of team 2 that changed code, its former code, and another of its live codes.
	var pick struct {
		ID          uint64
		ProductCode string
		OldCode     string
	}

	err := quiet.Raw(`SELECT p.id, p.product_code, l.old_code FROM products p JOIN product_logs l ON l.product_id = p.id
		WHERE p.team_id = 2 AND NOT p.archived ORDER BY p.id LIMIT 1 OFFSET 2000`).Scan(&pick).Error
	if err != nil || pick.ID == 0 {
		t.Fatalf("pick a changed product: %v", err)
	}

	var all []uint64

	err = quiet.Model(&product_service_models.Product{}).Order("id").Pluck("id", &all).Error
	if err != nil {
		t.Fatal(err)
	}

	held := make([]uint64, 0, 6_000)
	for i, id := range all {
		if (i%16 == 0 || id == pick.ID) && len(held) < 6_000 {
			held = append(held, id)
		}
	}

	var team2 []uint64

	err = quiet.Model(&product_service_models.Product{}).Where("team_id = 2").Order("id").Limit(200).Pluck("id", &team2).Error
	if err != nil {
		t.Fatal(err)
	}

	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)
	ctx := ptCtx(ptSeller)

	terms := []struct{ name, q string }{
		{"a former code", strings.ToLower(pick.OldCode)},
		{"a live code", pick.ProductCode},
		{"a name piece", "Produk 00123"},
		{"nothing", "ZZZ-NOTHING-9"},
	}

	list := func(q string) func() {
		return func() {
			res, listErr := svc.ProductList(ctx, connect.NewRequest(&productv1.ProductListRequest{
				TeamId: 2, Filter: &productv1.ProductListFilter{Q: q},
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if listErr != nil {
				t.Fatalf("ProductList: %v", listErr)
			}

			if q == terms[0].q && res.Msg.GetPageInfo().GetTotalItems() != 1 {
				t.Fatalf("ProductList by the former code %q found %d", q, res.Msg.GetPageInfo().GetTotalItems())
			}
		}
	}

	among := func(q string) func() {
		return func() {
			_, total, searchErr := svc.SearchAmong(ctx, product_v1.ProductSearchAmong{IDs: held, Q: q, WithTags: true, Limit: 20})
			if searchErr != nil {
				t.Fatalf("SearchAmong: %v", searchErr)
			}

			if q == terms[0].q && total != 1 {
				t.Fatalf("SearchAmong by the former code %q found %d", q, total)
			}
		}
	}

	codesOf := func() {
		_, byIdsErr := svc.ProductCodesByIds(ctx, connect.NewRequest(&productv1.ProductCodesByIdsRequest{TeamId: 2, ProductIds: team2}))
		if byIdsErr != nil {
			t.Fatalf("ProductCodesByIds: %v", byIdsErr)
		}
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

	// The plan of one statement, each line cut short — the held set's 6 000 ids would otherwise fill the log.
	plan := func(label, sql string) {
		var lines []string

		explainErr := quiet.Raw("EXPLAIN (ANALYZE, BUFFERS) " + sql).Scan(&lines).Error
		if explainErr != nil {
			t.Fatalf("explain %s: %v", label, explainErr)
		}

		for i, line := range lines {
			if len(line) > 160 {
				lines[i] = line[:160] + "…"
			}
		}

		t.Logf("%s · plan:\n%s", label, strings.Join(lines, "\n"))
	}

	explain := func(label string, call func(), marker string) {
		probe.Reset()
		call()

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, marker) && !strings.Contains(q.SQL, "SAVEPOINT") && !strings.Contains(q.SQL, "RELEASE") {
				plan(label, q.SQL)
			}
		}
	}

	measure := func(label string, plans bool) {
		for _, term := range terms {
			timed(fmt.Sprintf("%s · ProductList (%s)", label, term.name), list(term.q))
			timed(fmt.Sprintf("%s · SearchAmong 6 000 held (%s)", label, term.name), among(term.q))
		}

		timed(label+" · ProductCodesByIds 200", codesOf)

		if plans {
			explain(label+" · ProductList count · a former code", list(terms[0].q), "SELECT count(*)")
			explain(label+" · SearchAmong · a former code", among(terms[0].q), "COUNT(*) OVER ()")
			explain(label+" · ProductCodesByIds' codes", codesOf, "LEFT JOIN product_logs")
		}
	}

	generic := func(label string) {
		setErr := db.Exec(`SET LOCAL plan_cache_mode = force_generic_plan`).Error
		if setErr != nil {
			t.Fatal(setErr)
		}

		for _, term := range terms[:2] {
			timed(fmt.Sprintf("%s · generic plan · ProductList (%s)", label, term.name), list(term.q))
			timed(fmt.Sprintf("%s · generic plan · SearchAmong 6 000 held (%s)", label, term.name), among(term.q))
		}

		setErr = db.Exec(`SET LOCAL plan_cache_mode = auto`).Error
		if setErr != nil {
			t.Fatal(setErr)
		}
	}

	exec := func(sqls ...string) {
		for _, sql := range sqls {
			execErr := db.Exec(sql).Error
			if execErr != nil {
				t.Fatalf("%s: %v", sql, execErr)
			}
		}
	}

	const (
		dropIndex   = `DROP INDEX IF EXISTS product_logs_old_code_idx`
		createIndex = `CREATE INDEX IF NOT EXISTS product_logs_old_code_idx ON product_logs (lower(old_code))`
	)

	// HEAD's search, before the former codes (the term on the name and the live code only) — the same statements by hand,
	// so the cost the former-code branch adds is read against what the lists asked until now.
	headTerm := "%" + strings.ToLower(pick.OldCode) + "%"
	heldParam := "{" + strings.Trim(strings.Join(strings.Fields(fmt.Sprint(held)), ","), "[]") + "}"
	headList := fmt.Sprintf(`SELECT count(*) FROM "products" WHERE (team_id = 2 AND archived = false) `+
		`AND (name ILIKE '%s' OR product_code ILIKE '%s')`, headTerm, headTerm)
	headAmong := fmt.Sprintf(`SELECT products.*, COUNT(*) OVER () AS total_matches FROM "products" `+
		`WHERE id = ANY(CAST('%s' AS bigint[])) AND (name ILIKE '%s' OR product_code ILIKE '%s') `+
		`ORDER BY name ASC, product_code ASC, id ASC LIMIT 20`, heldParam, headTerm, headTerm)

	headTimed := func(label, sql string) {
		timed(label, func() {
			var n []map[string]any

			quiet.Raw(sql).Scan(&n)
		})
	}

	// WITHOUT the index first — dropped inside the test's transaction (when the migration made it), back with the rollback —
	// then WITH, then both again: two rounds each way, so neither side alone reads the cache cold.
	for round := 1; round <= 2; round++ {
		exec(dropIndex, `ANALYZE product_logs`)

		headTimed(fmt.Sprintf("round %d · HEAD's clause · ProductList count (a former code)", round), headList)
		headTimed(fmt.Sprintf("round %d · HEAD's clause · SearchAmong page (a former code)", round), headAmong)

		if round == 1 {
			plan("HEAD's clause · ProductList count", headList)
			plan("HEAD's clause · SearchAmong page", headAmong)
		}

		measure(fmt.Sprintf("round %d · WITHOUT product_logs_old_code_idx", round), round == 1)
		generic(fmt.Sprintf("round %d · WITHOUT product_logs_old_code_idx", round))

		exec(createIndex, `ANALYZE product_logs`)
		measure(fmt.Sprintf("round %d · WITH product_logs_old_code_idx", round), round == 1)
		generic(fmt.Sprintf("round %d · WITH product_logs_old_code_idx", round))
	}

	// THE WRITER: team 2's code changes (PFA → PFB, 20 000 history lines), without and with the index in an A-B-B-A order,
	// each change rolled back (a savepoint) so every pass recomposes the same rows into the same table.
	errUndo := errors.New("undo the pass")

	recompose := func(label string) {
		start := time.Now()

		var report product_v1.TeamRecomposeReport

		txErr := db.Transaction(func(tx *gorm.DB) error {
			var recErr error

			report, recErr = svc.RecomposeTeamCodes(context.Background(), tx, 2, "PFA", "PFB", rcActor)
			if recErr != nil {
				return recErr
			}

			return errUndo
		})
		if !errors.Is(txErr, errUndo) {
			t.Fatalf("RecomposeTeamCodes: %v", txErr)
		}

		t.Logf("%s · RecomposeTeamCodes PFA → PFB (rolled back), %d products, wall %v", label, report.Recomposed, time.Since(start))
	}

	// The recompose's history statement alone, rolled back each time (a savepoint), so every pass writes the same 20 000
	// lines into the same table — the index's own write cost, apart from the change's other statements.
	historyInsert := func(label string) {
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			start := time.Now()

			txErr := db.Transaction(func(tx *gorm.DB) error {
				insertErr := tx.Exec(`INSERT INTO product_logs (product_id, kind, old_code, new_code, actor_id, is_override, created_at)
					SELECT id, 'code_changed', product_code, 'PFZ' || substr(product_code, 4), 41, true, NOW()
					FROM products WHERE team_id = 2`).Error
				if insertErr != nil {
					return insertErr
				}

				return errUndo
			})
			if !errors.Is(txErr, errUndo) {
				t.Fatalf("history insert: %v", txErr)
			}

			walls = append(walls, time.Since(start))
		}

		t.Logf("%s · the history INSERT … SELECT of 20 000 lines alone MEDIAN wall %v", label, san_perf.Median(walls))
	}

	without := func() { exec(dropIndex) }
	with := func() { exec(createIndex) }

	// A B B A, three times over.
	for i := range 12 {
		if i%4 == 0 || i%4 == 3 {
			without()
			historyInsert("WITHOUT product_logs_old_code_idx")
			recompose("WITHOUT product_logs_old_code_idx")
		} else {
			with()
			historyInsert("WITH product_logs_old_code_idx")
			recompose("WITH product_logs_old_code_idx")
		}
	}
}
