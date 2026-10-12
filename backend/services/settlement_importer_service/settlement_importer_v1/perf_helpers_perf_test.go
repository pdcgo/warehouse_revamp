//go:build perfaudit

// Shared seeding and measuring for the settlement_importer_service performance audits (the
// audit-rpc-performance skill). Each RPC's probe is in its own <rpc>_perf_test.go:
//
//	go test -tags perfaudit -run TestPerf_ -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// THE VOLUMES. uploaded_files is a log — one row per statement a team uploads, and a team uploads DAILY
// per shop (cs-and-up-import-daily) — so it is seeded at the skill's transaction volume, ~50,000, across
// 50 teams. The audited team is a large one: 10 shops, a year of daily uploads (3,650 rows). The other
// 49 teams have 4 shops over 236 days (944 rows each).
//
// uploaded_file_lines holds every line of every file. The audited file is a full statement — 1,500 lines,
// where the largest real statement read 1,463 — beside 50 other files of 1,000 lines each.
const (
	perfAuditedShops = 10
	perfAuditedDays  = 365
	perfOtherTeams   = 49
	perfOtherShops   = 4
	perfOtherDays    = 236
	perfFileLines    = 1_500
	perfOtherFiles   = 50
	perfOtherLines   = 1_000
)

// perfVolume is what the seed produced, and the ids the probes ask about.
type perfVolume struct {
	files     int
	lines     int
	teamFiles []uint64 // the audited team's files, newest first
	file      uint64   // the audited file — a full statement's lines
}

// perfSeed writes both tables at volume (and ANALYZEs them — san_perf.SeedRows), invisible to the probe.
func perfSeed(t *testing.T, db *gorm.DB) perfVolume {
	t.Helper()

	now := time.Now()

	shops := []uint64{shopeeShop, tiktokShop}
	for s := uint64(1); len(shops) < perfAuditedShops; s++ {
		shops = append(shops, 100+s)
	}

	files := make([]settlement_importer_service_models.UploadedFile, 0,
		perfAuditedShops*perfAuditedDays+perfOtherTeams*perfOtherShops*perfOtherDays)

	for d := range perfAuditedDays {
		for s, shop := range shops {
			files = append(files, perfFile(team, shop, s, d, now))
		}
	}

	for n := range perfOtherTeams {
		other := uint64(1_000 + n)

		for d := range perfOtherDays {
			for s := range perfOtherShops {
				files = append(files, perfFile(other, 10_000+other*10+uint64(s), s, d, now))
			}
		}
	}

	san_perf.SeedRows(t, db, &files)

	vol := perfVolume{files: len(files)}

	mine := []settlement_importer_service_models.UploadedFile{}
	for i := range files {
		if files[i].TeamID == team {
			mine = append(mine, files[i])
		}
	}

	sort.Slice(mine, func(i, j int) bool {
		if !mine[i].CreatedAt.Equal(mine[j].CreatedAt) {
			return mine[i].CreatedAt.After(mine[j].CreatedAt)
		}

		return mine[i].ID > mine[j].ID
	})

	for i := range mine {
		vol.teamFiles = append(vol.teamFiles, mine[i].ID)
	}

	// The audited file is yesterday's statement of the Shopee shop; the other lines belong to 25 more of the
	// audited team's files and 25 of other teams'.
	vol.file = files[perfAuditedShops].ID

	others := []uint64{}
	for i := 2 * perfAuditedShops; len(others) < perfOtherFiles/2; i++ {
		others = append(others, files[i].ID)
	}

	for i := perfAuditedShops * perfAuditedDays; len(others) < perfOtherFiles; i += 97 {
		others = append(others, files[i].ID)
	}

	lines := make([]settlement_importer_service_models.UploadedFileLine, 0, perfFileLines+perfOtherFiles*perfOtherLines)

	for i := range perfFileLines {
		lines = append(lines, perfLine(vol.file, i, perfFileLines, now))
	}

	for _, id := range others {
		for i := range perfOtherLines {
			lines = append(lines, perfLine(id, i, perfOtherLines, now))
		}
	}

	san_perf.SeedRows(t, db, &lines)

	vol.lines = len(lines)

	t.Logf("PERF| seeded %d uploaded_files (%d the audited team's), %d uploaded_file_lines (%d the audited file's)",
		vol.files, len(vol.teamFiles), vol.lines, perfFileLines)

	return vol
}

// perfFile is one day's statement of one shop, as an import leaves it: done, with ~2% failed, a handful
// running right now, and ~0.3% interrupted — a server stopped in the middle of the file.
func perfFile(teamID, shopID uint64, s, d int, now time.Time) settlement_importer_service_models.UploadedFile {
	created := now.Add(-time.Duration(d)*24*time.Hour - time.Duration(s+1)*7*time.Minute)
	day := time.Date(created.Year(), created.Month(), created.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)

	from := day
	if d%7 == 0 {
		from = day.AddDate(0, 0, -6) // a weekly statement now and then
	}

	to := day
	finished := created.Add(90 * time.Second)

	platform := "shopee"
	if s%2 == 1 {
		platform = "tiktok"
	}

	total := 200 + (d*37+s*11)%1_300

	row := settlement_importer_service_models.UploadedFile{
		TeamID:           teamID,
		ShopID:           shopID,
		Platform:         platform,
		DocumentID:       fmt.Sprintf("doc-%d-%d-%d", teamID, shopID, d),
		ContentSha256:    fmt.Sprintf("%064x", teamID<<40|shopID<<16|uint64(d)),
		PeriodFrom:       &from,
		PeriodTo:         &to,
		Status:           "done",
		RowsTotal:        total,
		RowsPosted:       total * 80 / 100,
		RowsExisting:     total * 5 / 100,
		RowsHeld:         total * 5 / 100,
		RowsSkipped:      total - total*80/100 - total*5/100 - total*5/100,
		RowsPostedToShop: total * 8 / 100,
		CreatedByUserID:  uploader,
		PrimaryUserID:    primaryCS,
		CreatedAt:        created,
		UpdatedAt:        finished,
		FinishedAt:       &finished,
	}

	fresh := d == 0 && ((teamID == team && s < 3) || (teamID%10 == 0 && s == 0))

	switch {
	case fresh:
		row.CreatedAt = now.Add(-40 * time.Second)
		row.UpdatedAt = now.Add(-10 * time.Second)
		row.Status = "running"
		row.FinishedAt = nil
	case (d*7+s*13+int(teamID))%331 == 5:
		row.Status = "running"
		row.UpdatedAt = created.Add(40 * time.Second)
		row.FinishedAt = nil
	case (d+s)%50 == 3:
		row.Status = "failed"
		row.Failure = "The statement's rows cannot be read"
	}

	return row
}

// perfLine is one line of a statement, in a mix of outcomes like a real Shopee week: per 100 lines, 4 held,
// 6 skipped, 8 posted to the shop (no_order), 7 already there, and the rest posted to their order.
func perfLine(fileID uint64, i, n int, now time.Time) settlement_importer_service_models.UploadedFileLine {
	day := time.Date(2026, 9, 1+i*7/n, 0, 0, 0, 0, time.UTC)

	line := settlement_importer_service_models.UploadedFileLine{
		UploadedFileID:  fileID,
		LineNo:          i + 1,
		Sheet:           "Rincian Transaksi",
		UniqueID:        fmt.Sprintf("shopee:rincian_transaksi:%032x", fileID<<20|uint64(i)),
		OrderRef:        fmt.Sprintf("2609%08dAB", i),
		PlatformType:    "Penghasilan dari Pesanan",
		Description:     fmt.Sprintf("Penghasilan dari Pesanan #2609%08dAB", i),
		SettlementType:  "fund",
		Change:          int64(10_000 + i*37),
		OccurredOn:      &day,
		OrderID:         uint64(500_000 + i),
		Outcome:         "posted",
		SettlementLogID: uint64(9_000_000 + i),
		CreatedAt:       now,
	}

	switch k := i % 100; {
	case k < 3:
		line.Outcome, line.Reason, line.Detail = "held", "unmapped_type", "Biaya Program Baru"
		line.SettlementType, line.OrderID, line.SettlementLogID = "", 0, 0
	case k == 3:
		line.Outcome, line.Reason, line.Detail = "held", "fractional_amount", "1250.5"
		line.OrderID, line.SettlementLogID = 0, 0
	case k < 10:
		line.Outcome, line.Reason, line.Detail = "skipped", "failed_withdrawal", "Gagal, Transaksi Keluar"
		line.PlatformType, line.OrderRef, line.SettlementType = "Penarikan Dana", "", "withdrawal"
		line.OrderID, line.SettlementLogID = 0, 0
	case k < 18:
		line.Reason = "no_order"
		line.OrderID = 0
	case k < 25:
		line.Outcome = "existing"
	}

	return line
}

// perfRun warms once (i = -1), then measures 5 runs and logs each, the median, and the probe's report.
func perfRun(t *testing.T, probe *san_perf.Probe, name string, call func(i int) error) time.Duration {
	t.Helper()

	err := call(-1)
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)
	dbs := make([]time.Duration, 0, 5)

	for i := range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			err = call(i)
		})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		walls = append(walls, wall)
		dbs = append(dbs, dbTime)
		t.Logf("PERF| %s run %d wall=%v db=%v go=%v queries=%d", name, i, wall, dbTime, wall-dbTime, probe.Count())
	}

	median := san_perf.Median(walls)
	t.Logf("PERF| %s MEDIAN wall=%v db=%v max wall=%v queries=%d", name, median, san_perf.Median(dbs), perfMax(walls), probe.Count())
	probe.Report(t, name)

	return median
}

// perfMean is the wall/db split as a MEAN over n back-to-back calls. Go's monotonic clock on the audit
// machine (Windows) moves in ~0.5 ms steps, so a single call's wall − db is mostly quantisation; summed
// over n calls it averages out. The probe is left holding the LAST call only, for perfExplainAll.
func perfMean(t *testing.T, probe *san_perf.Probe, name string, n int, call func() error) {
	t.Helper()

	var (
		wall   time.Duration
		dbTime time.Duration
		err    error
	)

	for range n {
		probe.Reset()

		w, d := probe.Measure(func() {
			err = call()
		})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		wall += w
		dbTime += d
	}

	each := wall / time.Duration(n)
	eachDB := dbTime / time.Duration(n)

	t.Logf("PERF| %s MEAN of %d: wall=%v db=%v go=%v (%.0f%% outside the db probe)",
		name, n, each, eachDB, each-eachDB, 100*float64(each-eachDB)/float64(max(each, 1)))
}

func perfMax(ds []time.Duration) time.Duration {
	var top time.Duration
	for _, d := range ds {
		top = max(top, d)
	}

	return top
}

// perfExplainAll plans every query of the last measured run, on the test's own transaction.
func perfExplainAll(t *testing.T, db *gorm.DB, probe *san_perf.Probe) {
	t.Helper()

	for _, q := range probe.Queries() {
		if strings.TrimSpace(q.SQL) == "" {
			continue
		}

		san_perf.Explain(t, db, q.SQL)
	}
}

// perfByStatement totals the last measured call's queries by STATEMENT — its verb and table. The probe's
// own report groups by a shape that swaps each digit for a '?', so one UPDATE splits by how many digits
// its tallies have; this is the same data, grouped by what the statement is.
func perfByStatement(t *testing.T, probe *san_perf.Probe, name string) {
	t.Helper()

	type total struct {
		n    int
		sum  time.Duration
		rows int64
	}

	totals := map[string]*total{}
	order := []string{}

	for _, q := range probe.Queries() {
		words := strings.Fields(q.SQL)
		if len(words) > 3 {
			words = words[:3]
		}

		key := strings.Join(words, " ")

		got, ok := totals[key]
		if !ok {
			got = &total{}
			totals[key] = got
			order = append(order, key)
		}

		got.n++
		got.sum += q.Duration
		got.rows += q.Rows
	}

	for _, key := range order {
		got := totals[key]
		t.Logf("PERF| %s by statement: %-40s ×%d rows=%d total=%v mean=%v",
			name, key, got.n, got.rows, got.sum.Round(time.Microsecond), (got.sum / time.Duration(got.n)).Round(time.Microsecond))
	}
}

// perfExplainShapes plans ONE query of each statement shape — an import issues thousands of the same two.
// EXPLAIN ANALYZE executes a write too; harmless, the transaction rolls back.
func perfExplainShapes(t *testing.T, db *gorm.DB, probe *san_perf.Probe) {
	t.Helper()

	seen := map[string]bool{}

	for _, q := range probe.Queries() {
		key := q.SQL
		if len(key) > 40 {
			key = key[:40]
		}

		if seen[key] {
			continue
		}

		seen[key] = true
		san_perf.Explain(t, db, q.SQL)
	}
}

// ── the imports ─────────────────────────────────────────────────────────────────────────────────

// perfShopeeStatement is a full Shopee week of n rows, like the real ones: mostly order income, a
// completed withdrawal every 50 rows, a failed withdrawal and its refund now and then, an adjustment, and
// a type nobody mapped. It answers the refs its order rows carry, so the orders fake can find 70% of them.
func perfShopeeStatement(t *testing.T, n int) ([]byte, []string) {
	t.Helper()

	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	step := 7 * 24 * time.Hour / time.Duration(n+1)

	rows := make([]shopeeRow, 0, n)
	refs := []string{}
	balance := int64(5_000_000)

	for i := range n {
		at := start.Add(time.Duration(i) * step).Format("2006-01-02 15:04:05")

		kind, description, ref, direction, status := "Penghasilan dari Pesanan", "", "-", "Transaksi Masuk", "Transaksi Selesai"
		amount := int64(10_000 + (i*37)%250_000)

		switch {
		case i%50 == 49:
			kind, description, direction, amount = "Penarikan Dana", "Penarikan Dana", "Transaksi Keluar", -1_500_000
		case i%200 == 101:
			kind, description, direction, status, amount = "Penarikan Dana", "Penarikan Dana", "Transaksi Keluar", "Gagal", -250_000
		case i%200 == 102:
			kind, description, amount = "Penarikan Dana", "Pengembalian Dana untuk Penarikan Gagal", 250_000
		case i%250 == 7:
			kind, description, amount = "Penyesuaian", "Penyesuaian", -12_000
		case i%500 == 311:
			kind, description, direction, amount = "Biaya Program Baru", "Biaya Program Baru", "Transaksi Keluar", -15_000
		default:
			ref = fmt.Sprintf("2609%08dAB", i)
			description = "Penghasilan dari Pesanan #" + ref
			refs = append(refs, ref)
		}

		balance += amount

		rows = append(rows, shopeeRow{
			at, kind, description, ref, direction,
			fmt.Sprintf("%d.00", amount), status, fmt.Sprintf("%d.00", balance),
		})
	}

	return shopeeStatement(t, rows...), refs
}

// perfTiktokStatement is a TikTok week of orders commissioned orders (two lines each), plain orders,
// reimbursements and withdrawals — about orders*2 + extra lines.
func perfTiktokStatement(t *testing.T, commissioned, plain, withdrawals int) ([]byte, []string) {
	t.Helper()

	orders := []tiktokOrder{}
	refs := []string{}

	for i := range commissioned + plain {
		id := fmt.Sprintf("57%08d", i)
		settled := fmt.Sprintf("2026/09/%02d", 1+i%7)
		amount := fmt.Sprintf("%d", 50_000+(i*53)%200_000)

		affiliate, shopAds := "-2500", "-500"
		if i >= commissioned {
			affiliate, shopAds = "0", "0"
		}

		orders = append(orders, tiktokOrder{id, "Order", id, settled, amount, affiliate, shopAds})
		refs = append(refs, id)

		if i%40 == 0 {
			orders = append(orders, tiktokOrder{fmt.Sprintf("77%08d", i), "Logistics reimbursement", id, settled, "8000", "", ""})
		}
	}

	ws := []tiktokWithdrawal{}
	for i := range withdrawals {
		status := "Transferred"
		if i%5 == 4 {
			status = "Processing"
		}

		ws = append(ws, tiktokWithdrawal{"Withdrawal", fmt.Sprintf("WD%05d", i), fmt.Sprintf("2026/09/%02d", 1+i%7), "-120000", status})
	}

	return tiktokStatement(t, "IDR", false, orders, ws), refs
}

// perfOrdersFor finds 7 of every 10 refs as an order of shopID — the rest post to the shop.
func perfOrdersFor(refs []string, shopID uint64) map[string][]settlement_importer_v1.OrderRef {
	out := map[string][]settlement_importer_v1.OrderRef{}

	for i, ref := range refs {
		if i%10 < 7 {
			out[ref] = []settlement_importer_v1.OrderRef{{OrderID: uint64(700_000 + i), ShopID: shopID, CreatedByUserID: orderMaker}}
		}
	}

	return out
}

// perfImporter is a fresh importer over db — its own fakes, so every run is a FIRST upload that posts —
// and a client on the real streamed handler. Built outside the measured window.
func perfImporter(t *testing.T, db *gorm.DB, found map[string][]settlement_importer_v1.OrderRef) (*world, settlement_importerv1connect.SettlementImporterServiceClient) {
	t.Helper()

	w := newWorld(t, db)
	w.orders.byRef = found

	return w, w.client(t)
}

// perfStreamShopee runs one import to its end over the real stream. The handler holds the stream open
// until the detached import is done, so the stream's end is the import's.
func perfStreamShopee(
	ctx context.Context,
	client settlement_importerv1connect.SettlementImporterServiceClient,
	shopID uint64,
	content []byte,
) (int, message, error) {
	stream, err := client.ShopeeSettlementImport(ctx, connect.NewRequest(&settlement_importerv1.ShopeeSettlementImportRequest{
		TeamId: team, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		return 0, message{}, err
	}
	defer stream.Close()

	n := 0

	var end message

	for stream.Receive() {
		m := stream.Msg()
		n++
		end = message{m.GetLevel(), m.GetMessage(), m.GetStep(), m.GetCount(), m.GetFile()}
	}

	return n, end, stream.Err()
}

func perfStreamTiktok(
	ctx context.Context,
	client settlement_importerv1connect.SettlementImporterServiceClient,
	shopID uint64,
	content []byte,
) (int, message, error) {
	stream, err := client.TiktokSettlementImport(ctx, connect.NewRequest(&settlement_importerv1.TiktokSettlementImportRequest{
		TeamId: team, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		return 0, message{}, err
	}
	defer stream.Close()

	n := 0

	var end message

	for stream.Receive() {
		m := stream.Msg()
		n++
		end = message{m.GetLevel(), m.GetMessage(), m.GetStep(), m.GetCount(), m.GetFile()}
	}

	return n, end, stream.Err()
}

// perfCheckDone fails unless an import ended DONE — with `rows` rows read, when rows is not negative.
func perfCheckDone(end message, rows int) error {
	file := end.file
	if file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE ||
		(rows >= 0 && int(file.GetTally().GetTotal()) != rows) {
		return fmt.Errorf("the import ended %v with %d of %d rows: %s", file.GetStatus(), file.GetTally().GetTotal(), rows, end.text)
	}

	return nil
}

// perfTableStat is what the statistics say was done to one of the two tables.
type perfTableStat struct {
	Relname    string
	NTupIns    int64
	NTupUpd    int64
	NTupHotUpd int64
}

func perfXactStats(t *testing.T, db *gorm.DB) []perfTableStat {
	t.Helper()

	var out []perfTableStat

	// A session of its own logger, so the probe never records (or later EXPLAINs) this read.
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Raw(`SELECT relname, n_tup_ins, n_tup_upd, n_tup_hot_upd
		FROM pg_stat_xact_user_tables
		WHERE relname IN ('uploaded_files', 'uploaded_file_lines')
		ORDER BY relname`).
		Scan(&out).
		Error
	if err != nil {
		t.Fatalf("read the transaction's table stats: %v", err)
	}

	return out
}
