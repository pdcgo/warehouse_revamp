//go:build perfaudit

// Performance audit for SettlementPost's IMPORTED SHOP ROW path (the audit-rpc-performance skill).
//
// settlement-asks-the-shop-for-its-primary-cs: a row the importer posts to a SHOP (no order) asks the
// shop for its primary CS BEFORE the ledger transaction — one ShopAccessCheck per row, and an import posts
// up to ~1,500 of them. This file measures what that ask costs, against a hand-posted shop row that never
// asks:
//
//	manual    a hand-posted shop row — no ask. The baseline.
//	stub      an imported shop row, the ask answered in memory — the ledger's own cost.
//	connect   an imported shop row, the ask answered by selling's REAL ShopAccessCheck, mounted on an
//	          httptest server and called through a Connect client — the production adapter's shape
//	          (cmd/app_development/shop_primary.go), over loopback.
//
// ⚠ SELLING'S SEED lives only in the rolled-back san_testdb transaction, and selling's handler reads
// through that same transaction. The ledger is measured twice: inside that transaction too (the skill's
// method), and COMMITTING on the pool — the production shape, BEGIN and COMMIT included — with settlement's
// own tables emptied by san_race before and after.
//
// ⚠ BATCHED. Go's monotonic clock on Windows ticks in ~0.5 ms steps, below one call's cost, so every sample
// times impPerfBatch calls and divides.
//
//	go test -tags perfaudit -run TestPerf_SettlementPostImported -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// The seed: one team of 1 000 shops, 10 000 orders, and a 50 000-row log — 40 000 order rows (four per
// order) and 10 000 shop rows (ten per shop). A team of its own, so no committing test elsewhere can
// collide with a key or a shop code held by the uncommitted transaction.
const (
	impPerfTeam       uint64 = 902
	impPerfShops             = 1_000
	impPerfOrders            = 10_000
	impPerfOrderRows         = 4
	impPerfShopRows          = 10
	impPerfFirstOrder uint64 = 7_000_000
	impPerfRuns              = 5
	impPerfBatch             = 100
	impPerfStatement         = 1_500
)

var impPerfDay = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

// Settlement's own tables — the ONLY tables the committing variant writes, and so the only ones it empties.
var impPerfCommitTables = []string{
	"settlement_logs",
	"order_settlements",
	"shop_settlements",
}

// connectShopPrimary is cmd/app_development's shopPrimary, re-typed because that one lives in package
// main: settlement's ShopPrimary answered by ShopAccessCheck over a Connect client.
type connectShopPrimary struct {
	shops sellingv1connect.ShopServiceClient
	asked int
}

func (p *connectShopPrimary) PrimaryUser(ctx context.Context, teamID, shopID, askingUserID uint64) (uint64, error) {
	p.asked++

	resp, err := p.shops.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: teamID,
		ShopId: shopID,
		UserId: askingUserID,
	}))
	if err != nil {
		return 0, err
	}

	return resp.Msg.GetPrimaryUserId(), nil
}

// impSeedSelling seeds selling's side of the ask: the team's shops, each with three grants — the primary
// CS, the uploader, and one other CS. The uploader holds a grant, so ShopAccessCheck answers without a
// role lookup (a manager uploading would add one, served from user_service's cache in production).
func impSeedSelling(t *testing.T, db *gorm.DB) []uint64 {
	t.Helper()

	shops := make([]selling_service_models.Shop, 0, impPerfShops)
	for i := 0; i < impPerfShops; i++ {
		shops = append(shops, selling_service_models.Shop{
			TeamID:      impPerfTeam,
			Name:        fmt.Sprintf("Perf shop %d", i),
			ShopCode:    fmt.Sprintf("PERFIMP-%05d", i),
			Marketplace: "shopee",
		})
	}

	san_perf.SeedRows(t, db, &shops)

	ids := make([]uint64, 0, impPerfShops)
	grants := make([]selling_service_models.ShopUser, 0, impPerfShops*3)

	for i, shop := range shops {
		ids = append(ids, shop.ID)
		grants = append(grants,
			selling_service_models.ShopUser{ShopID: shop.ID, UserID: shopPrimaryCS, IsPrimary: true},
			selling_service_models.ShopUser{ShopID: shop.ID, UserID: uploader},
			selling_service_models.ShopUser{ShopID: shop.ID, UserID: uint64(1_000 + i%50)},
		)
	}

	san_perf.SeedRows(t, db, &grants)

	return ids
}

// impSeedLedger seeds settlement's side: the log, and both accounts proportionally.
func impSeedLedger(t *testing.T, db *gorm.DB, shopIDs []uint64) {
	t.Helper()

	logs := make([]settlement_service_models.SettlementLog, 0, impPerfOrders*impPerfOrderRows+impPerfShops*impPerfShopRows)
	orders := make([]settlement_service_models.OrderSettlement, 0, impPerfOrders)
	accounts := make([]settlement_service_models.ShopSettlement, 0, impPerfShops)

	orderTypes := []string{"initial_total", "fund", "affiliate_fee", "marketplace_adjustment"}
	orderChanges := []int64{-100_000, 90_000, -3_000, -1_000}

	for o := 0; o < impPerfOrders; o++ {
		orderID := impPerfFirstOrder + uint64(o)
		shopID := shopIDs[o%impPerfShops]

		var balance int64

		for r := 0; r < impPerfOrderRows; r++ {
			balance += orderChanges[r]
			id := orderID

			logs = append(logs, settlement_service_models.SettlementLog{
				OrderID:        &id,
				ShopID:         shopID,
				TeamID:         impPerfTeam,
				ActorID:        uploader,
				SourceType:     "importer",
				SettlementType: orderTypes[r],
				Change:         orderChanges[r],
				Balance:        balance,
				UniqueID:       fmt.Sprintf("perfimp-seed-order-%d-%d", o, r),
				OccurredOn:     impPerfDay.AddDate(0, 0, o%28),
				PostedOn:       impPerfDay.AddDate(0, 0, o%28),
			})
		}

		orders = append(orders, settlement_service_models.OrderSettlement{
			OrderID:         orderID,
			TeamID:          impPerfTeam,
			ShopID:          shopID,
			InitialTotal:    100_000,
			LastBalance:     balance,
			CreatedByUserID: shopPrimaryCS,
		})
	}

	for s, shopID := range shopIDs {
		var balance int64

		for r := 0; r < impPerfShopRows; r++ {
			balance -= 1_000

			logs = append(logs, settlement_service_models.SettlementLog{
				ShopID:         shopID,
				TeamID:         impPerfTeam,
				ActorID:        uploader,
				UserID:         shopPrimaryCS,
				SourceType:     "importer",
				SettlementType: "withdrawal",
				Change:         -1_000,
				Balance:        balance,
				UniqueID:       fmt.Sprintf("perfimp-seed-shop-%d-%d", s, r),
				OccurredOn:     impPerfDay.AddDate(0, 0, r),
				PostedOn:       impPerfDay.AddDate(0, 0, r),
			})
		}

		accounts = append(accounts, settlement_service_models.ShopSettlement{
			ShopID:      shopID,
			TeamID:      impPerfTeam,
			LastBalance: balance,
		})
	}

	san_perf.SeedRows(t, db, &logs)
	san_perf.SeedRows(t, db, &orders)
	san_perf.SeedRows(t, db, &accounts)
}

// impShopRow is one shop row as either writer posts it — the same type and amount, so the ledger's work
// is identical and only the source (and so the ask) differs.
func impShopRow(shopID uint64, source settlementv1.SourceType, uniqueID string) settlement_v1.PostInput {
	return settlement_v1.PostInput{
		TeamID:         impPerfTeam,
		ShopID:         shopID,
		UniqueID:       uniqueID,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     source,
		Change:         -1_000,
		OccurredOn:     "2026-09-28",
		ActorID:        uploader,
	}
}

// impSample is one measured variant — per CALL, the median over impPerfRuns batches.
type impSample struct {
	name     string
	wall     time.Duration
	ledgerDB time.Duration
	askDB    time.Duration
	ledgerQ  float64
	askQ     float64
}

func (s impSample) rest() time.Duration {
	return s.wall - s.ledgerDB - s.askDB
}

// impMeasure is measureRPC for a call that spends time on TWO probes — settlement's ledger and selling's
// ShopAccessCheck — and for a call below the clock's resolution: each sample is a batch of impPerfBatch
// calls, divided. call gets a number unique across the whole measurement, for its key.
func impMeasure(t *testing.T, name string, ledger, ask *san_perf.Probe, call func(i int) error) impSample {
	t.Helper()

	err := call(0) // warm-up: schema reflection, the pool, the loopback connection
	if err != nil {
		t.Fatalf("%s (warm-up): %v", name, err)
	}

	walls := make([]time.Duration, 0, impPerfRuns)
	ledgerDBs := make([]time.Duration, 0, impPerfRuns)
	askDBs := make([]time.Duration, 0, impPerfRuns)

	var ledgerQ, askQ float64

	for run := 1; run <= impPerfRuns; run++ {
		ledger.Reset()
		ask.Reset()

		start := time.Now()

		for k := 0; k < impPerfBatch; k++ {
			err = call(run*impPerfBatch + k)
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		}

		wall := time.Since(start) / impPerfBatch
		ledgerDB := ledger.DBTotal() / impPerfBatch
		askDB := ask.DBTotal() / impPerfBatch

		walls = append(walls, wall)
		ledgerDBs = append(ledgerDBs, ledgerDB)
		askDBs = append(askDBs, askDB)
		ledgerQ = float64(ledger.Count()) / impPerfBatch
		askQ = float64(ask.Count()) / impPerfBatch

		t.Logf("%s batch %d: per call wall=%v ledger db=%v (%.1f q) ask db=%v (%.1f q) rest=%v", name, run,
			wall, ledgerDB, ledgerQ, askDB, askQ, wall-ledgerDB-askDB)
	}

	sample := impSample{
		name:     name,
		wall:     san_perf.Median(walls),
		ledgerDB: san_perf.Median(ledgerDBs),
		askDB:    san_perf.Median(askDBs),
		ledgerQ:  ledgerQ,
		askQ:     askQ,
	}

	t.Logf("%s MEDIAN per call wall=%v ledger db=%v ask db=%v rest=%v queries=%.1f+%.1f", name,
		sample.wall, sample.ledgerDB, sample.askDB, sample.rest(), sample.ledgerQ, sample.askQ)

	return sample
}

var (
	impLiteral = regexp.MustCompile(`'[^']*'`)
	impNumber  = regexp.MustCompile(`\d+`)
)

// impExplainSelects EXPLAINs each distinct READ SHAPE of the last measured batch, on the test's own
// transaction. Writes are skipped: EXPLAIN ANALYZE executes them, and re-inserting a log row would trip
// its own unique key.
func impExplainSelects(t *testing.T, db *gorm.DB, probes ...*san_perf.Probe) {
	t.Helper()

	seen := map[string]bool{}

	for _, probe := range probes {
		for _, q := range probe.Queries() {
			sql := strings.TrimSpace(q.SQL)
			shape := impNumber.ReplaceAllString(impLiteral.ReplaceAllString(sql, "'?'"), "?")

			if !strings.HasPrefix(strings.ToUpper(sql), "SELECT") || seen[shape] {
				continue
			}

			seen[shape] = true
			san_perf.Explain(t, db, sql)
		}
	}
}

// impAskServer mounts selling's REAL ShopService on a loopback server, over the given db, and returns
// the Connect client settlement's adapter calls — shaped exactly like the composition root's.
func impAskServer(t *testing.T, sellingDB *gorm.DB) sellingv1connect.ShopServiceClient {
	t.Helper()

	selling := selling_v1.NewService(sellingDB, nil, nil, nil, nil, nil, nil)

	mux := http.NewServeMux()
	path, handler := sellingv1connect.NewShopServiceHandler(selling)
	mux.Handle(path, handler)

	srv := httptest.NewServer(mux)
	// Registered after san_testdb's rollback, so it runs FIRST: no handler is left on the transaction.
	t.Cleanup(srv.Close)

	return sellingv1connect.NewShopServiceClient(
		http.DefaultClient,
		srv.URL,
		connect.WithInterceptors(san_auth.ForwardBearer()),
	)
}

// impVariants measures the three ways of posting one shop row, plus the ask alone and the re-import.
func impVariants(t *testing.T, ledgerDB *gorm.DB, ledger, ask *san_perf.Probe, realAsk *connectShopPrimary, target uint64, tag string) []impSample {
	t.Helper()

	ctx := context.Background()

	manualSvc := settlement_v1.NewService(ledgerDB, nil, nil, nil)
	stubSvc := settlement_v1.NewService(ledgerDB, nil, nil, primaryIs(shopPrimaryCS))
	connectSvc := settlement_v1.NewService(ledgerDB, nil, nil, realAsk)

	postRow := func(svc *settlement_v1.Service, source settlementv1.SourceType, key string) func(int) error {
		return func(i int) error {
			result, err := svc.PostEntry(ctx, impShopRow(target, source, fmt.Sprintf("perfimp-%s-%s-%d", tag, key, i)))
			if err != nil {
				return err
			}

			if !result.Created {
				return errors.New("not created — the key was already used")
			}

			if source == settlementv1.SourceType_SOURCE_TYPE_IMPORTER && result.Entry.UserID != shopPrimaryCS {
				return fmt.Errorf("user_id = %d, want the primary CS %d", result.Entry.UserID, shopPrimaryCS)
			}

			return nil
		}
	}

	manual := impMeasure(t, tag+": manual shop row (no ask)", ledger, ask,
		postRow(manualSvc, settlementv1.SourceType_SOURCE_TYPE_MANUAL, "manual"))

	stub := impMeasure(t, tag+": imported shop row, stub ask", ledger, ask,
		postRow(stubSvc, settlementv1.SourceType_SOURCE_TYPE_IMPORTER, "stub"))

	viaConnect := impMeasure(t, tag+": imported shop row, Connect ShopAccessCheck", ledger, ask,
		postRow(connectSvc, settlementv1.SourceType_SOURCE_TYPE_IMPORTER, "connect"))

	ledger.Report(t, tag+": imported shop row, Connect — settlement statements, one batch")
	ask.Report(t, tag+": imported shop row, Connect — selling statements (the ask), one batch")

	askOnly := impMeasure(t, tag+": the ask alone (Connect ShopAccessCheck)", ledger, ask, func(int) error {
		primary, err := realAsk.PrimaryUser(ctx, impPerfTeam, target, uploader)
		if err != nil {
			return err
		}

		if primary != shopPrimaryCS {
			return fmt.Errorf("primary = %d, want %d", primary, shopPrimaryCS)
		}

		return nil
	})

	// THE RE-IMPORT. An overlapping statement re-posts rows already written; the idempotency check answers
	// them "already there" — but only AFTER the ask, which runs first.
	existing := fmt.Sprintf("perfimp-%s-connect-0", tag)
	asksBefore := realAsk.asked

	reimport := impMeasure(t, tag+": re-import of an already-written imported shop row", ledger, ask, func(int) error {
		result, err := connectSvc.PostEntry(ctx, impShopRow(target, settlementv1.SourceType_SOURCE_TYPE_IMPORTER, existing))
		if err != nil {
			return err
		}

		if result.Created {
			return errors.New("created — the key was expected to exist")
		}

		return nil
	})

	t.Logf("%s: re-import — %d posts of one already-written row asked the shop %d times", tag,
		impPerfRuns*impPerfBatch+1, realAsk.asked-asksBefore)

	return []impSample{manual, stub, viaConnect, askOnly, reimport}
}

// impSummary is the table the audit is written from, with the extrapolation to one statement.
func impSummary(t *testing.T, tag string, samples []impSample) {
	t.Helper()

	var b strings.Builder

	fmt.Fprintf(&b, "\n%s — per call, median of %d batches of %d\n\n", tag, impPerfRuns, impPerfBatch)
	fmt.Fprintf(&b, "| variant | wall | ledger db | ask db | rest (Go, HTTP, Connect) | queries (ledger+ask) | ×%d rows |\n", impPerfStatement)
	b.WriteString("| --- | --- | --- | --- | --- | --- | --- |\n")

	for _, s := range samples {
		fmt.Fprintf(&b, "| %s | %v | %v | %v | %v | %.1f+%.1f | %v |\n",
			s.name,
			s.wall.Round(time.Microsecond),
			s.ledgerDB.Round(time.Microsecond),
			s.askDB.Round(time.Microsecond),
			s.rest().Round(time.Microsecond),
			s.ledgerQ, s.askQ,
			(s.wall * impPerfStatement).Round(time.Millisecond),
		)
	}

	t.Log(b.String())
}

// TestPerf_SettlementPostImportedShopRow — the skill's method: everything inside the rolled-back
// transaction, against a 50 000-row log.
func TestPerf_SettlementPostImportedShopRow(t *testing.T) {
	base := san_testdb.DB(t)

	shopIDs := impSeedSelling(t, base)
	impSeedLedger(t, base, shopIDs)

	// The measured shop is one of the seeded thousand, with its ten rows and its account already there.
	target := shopIDs[impPerfShops/2]

	wrapped, ledgerProbe := san_perf.Wrap(base)
	sellingDB, askProbe := san_perf.Wrap(base)

	// ⚠ No nested savepoint per post. GORM never RELEASEs one, so hundreds of posts in one test
	// transaction would nest hundreds deep and slow every visibility check — a cost production (a real
	// BEGIN/COMMIT per post) never pays. The committing variant below carries BEGIN and COMMIT instead.
	ledgerDB := wrapped.Session(&gorm.Session{DisableNestedTransaction: true})

	realAsk := &connectShopPrimary{shops: impAskServer(t, sellingDB)}

	samples := impVariants(t, ledgerDB, ledgerProbe, askProbe, realAsk, target, "in-tx")

	// EXPLAIN the reads of one imported shop row, the ask's included.
	ledgerProbe.Reset()
	askProbe.Reset()

	_, err := settlement_v1.NewService(ledgerDB, nil, nil, realAsk).
		PostEntry(context.Background(), impShopRow(target, settlementv1.SourceType_SOURCE_TYPE_IMPORTER, "perfimp-explain"))
	if err != nil {
		t.Fatalf("explain post: %v", err)
	}

	impExplainSelects(t, base, ledgerProbe, askProbe)

	// What a re-import meets when the shop cannot answer — the row EXISTS, and the post is still refused.
	existing := "perfimp-in-tx-connect-0"

	_, err = settlement_v1.NewService(ledgerDB, nil, nil, &stubPrimary{err: errors.New("connection refused")}).
		PostEntry(context.Background(), impShopRow(target, settlementv1.SourceType_SOURCE_TYPE_IMPORTER, existing))
	t.Logf("re-posting an already-written imported shop row while the shop cannot answer → %v (%v)",
		connect.CodeOf(err), err)

	_, err = settlement_v1.NewService(ledgerDB, nil, nil, primaryIs(0)).
		PostEntry(context.Background(), impShopRow(target, settlementv1.SourceType_SOURCE_TYPE_IMPORTER, existing))
	t.Logf("re-posting an already-written imported shop row after the primary was removed → %v (%v)",
		connect.CodeOf(err), err)

	impSummary(t, "in-tx", samples)
}

// TestPerf_SettlementPostImportedShopRowCommitting — the production shape: the ledger COMMITS every post
// on the pool (BEGIN, the statements, COMMIT with its WAL flush), against the same 50 000-row log.
// Selling's seed stays in the rolled-back transaction; settlement's tables are emptied before and after.
func TestPerf_SettlementPostImportedShopRowCommitting(t *testing.T) {
	base := san_testdb.DB(t)

	shopIDs := impSeedSelling(t, base)
	target := shopIDs[impPerfShops/2]

	sellingDB, askProbe := san_perf.Wrap(base)
	realAsk := &connectShopPrimary{shops: impAskServer(t, sellingDB)}

	h := san_race.New(t, impPerfCommitTables...)
	impSeedLedger(t, h.DB(), shopIDs)

	ledgerDB, ledgerProbe := san_perf.Wrap(h.DB())

	samples := impVariants(t, ledgerDB, ledgerProbe, askProbe, realAsk, target, "committing")

	impSummary(t, "committing", samples)
}

// TestPerf_SettlementPostImportedStatementAsksPerRow is the "two page sizes" line of the skill, for a
// write: post a statement of N imported shop rows for ONE shop and count the asks. The answer never
// changes within a file — one shop, one primary — so every ask after the first repeats a question.
func TestPerf_SettlementPostImportedStatementAsksPerRow(t *testing.T) {
	base := san_testdb.DB(t)

	shopIDs := impSeedSelling(t, base)
	target := shopIDs[0]

	wrapped, ledgerProbe := san_perf.Wrap(base)
	sellingDB, askProbe := san_perf.Wrap(base)

	ledgerDB := wrapped.Session(&gorm.Session{DisableNestedTransaction: true})
	realAsk := &connectShopPrimary{shops: impAskServer(t, sellingDB)}
	svc := settlement_v1.NewService(ledgerDB, nil, nil, realAsk)
	ctx := context.Background()

	for _, n := range []int{20, 200} {
		ledgerProbe.Reset()
		askProbe.Reset()
		realAsk.asked = 0

		for i := 0; i < n; i++ {
			_, err := svc.PostEntry(ctx, impShopRow(target, settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
				fmt.Sprintf("perfimp-burst-%d-%d", n, i)))
			if err != nil {
				t.Fatalf("row %d of %d: %v", i, n, err)
			}
		}

		t.Logf("a statement of %d imported shop rows for ONE shop: %d asks, %d selling queries, %d ledger "+
			"statements — 1 distinct question", n, realAsk.asked, askProbe.Count(), ledgerProbe.Count())
	}
}
