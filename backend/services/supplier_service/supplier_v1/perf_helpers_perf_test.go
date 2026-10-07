//go:build perfaudit

// Shared seeding and measuring for the supplier_service performance audits (the audit-rpc-performance
// skill). Each RPC's probe is in its own <rpc>_perf_test.go.
//
//	go test -tags perfaudit -run TestPerf_ -v ./backend/services/supplier_service/supplier_v1/
//
// Volumes (the skill's table): `suppliers` is an ENTITY table — 10 000 rows over 50 teams (200 a team),
// every 20th soft-deleted (5 %). `supplier_channels` grows with it — 3 stores a supplier (30 000), every
// 20th soft-deleted, the channel type skewed the way marketplaces are (shopee/tokopedia heavy, blibli /
// bukalapak / other rare) — plus ONE supplier of the audited team with 300 stores, the Channels tab's
// worst case.
package supplier_v1_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

const (
	perfTeams                    = 50
	perfSuppliers                = 10_000
	perfStoresPerSupplier        = 3
	perfBigStores                = 300
	perfTeamBase          uint64 = 40_000

	// perfQ is a word of the name vocabulary — it hits ~3 % of supplier names and, through the stores,
	// ~10 % of suppliers more: the EXISTS over supplier_channels is what finds most of them.
	perfQ = "lestari"
	// perfRareQ is in NO supplier name — only in ~30 store names. The page cannot fill early, so the scan
	// runs to the end: the worst case of a search.
	perfRareQ = "batik"
)

// perfWords is the name vocabulary. 60 words, so one word is in ~3 % of two-word names.
var perfWords = []string{
	"Sumber", "Makmur", "Jaya", "Abadi", "Sentosa", "Mitra", "Grosir", "Kain", "Tekstil", "Indah",
	"Berkah", "Mulia", "Cahaya", "Lestari", "Prima", "Utama", "Sejahtera", "Karya", "Agung", "Baru",
	"Harapan", "Bintang", "Surya", "Mandiri", "Sukses", "Rejeki", "Murni", "Sinar", "Teknik", "Global",
	"Nusantara", "Persada", "Gemilang", "Lancar", "Maju", "Bersama", "Anugerah", "Permata", "Mas", "Intan",
	"Kurnia", "Setia", "Budi", "Santoso", "Wijaya", "Putra", "Putri", "Asia", "Pasifik", "Timur",
	"Barat", "Selatan", "Utara", "Raya", "Kencana", "Mutiara", "Sakti", "Perkasa", "Damai", "Indo",
}

var (
	perfPrefixes = []string{"PT", "CV", "UD", "Toko"}
	perfSuffixes = []string{"Official", "Store", "Shop", "Grosir", "Outlet"}
	perfCities   = []string{"Bandung", "Jakarta", "Surabaya", "Solo", "Semarang", "Medan", "Makassar", "Pekalongan"}
	// Skewed the way the marketplaces are: 6/20 shopee, 5/20 tokopedia, 4/20 tiktok, 2/20 lazada, 1/20 each
	// of the rest.
	perfTypes = []string{
		"shopee", "shopee", "shopee", "shopee", "shopee", "shopee",
		"tokopedia", "tokopedia", "tokopedia", "tokopedia", "tokopedia",
		"tiktok", "tiktok", "tiktok", "tiktok",
		"lazada", "lazada",
		"blibli", "bukalapak", "other",
	}
)

// perfPick is a deterministic scatter (splitmix64) — the same seed every run, no math/rand state to share,
// and no correlation between the columns a row draws (a plain multiplicative step would tie a deleted
// store to one channel type).
func perfPick(i, salt, n int) int {
	x := uint64(i)*0x9E3779B97F4A7C15 + uint64(salt)*0xBF58476D1CE4E5B9
	x ^= x >> 30
	x *= 0xBF58476D1CE4E5B9
	x ^= x >> 27
	x *= 0x94D049BB133111EB
	x ^= x >> 31

	return int(x % uint64(n))
}

// perfSellingTeams answers "selling" for every team — the audit measures the supplier's own queries, not
// the team_service call (a fake here, a network hop in production — see each report's Not measured).
type perfSellingTeams struct{}

func (perfSellingTeams) IsSelling(context.Context, uint64) (bool, error) { return true, nil }

type perfBook struct {
	db    *gorm.DB
	probe *san_perf.Probe
	svc   *supplier_v1.Service
	team  uint64 // the audited team

	big        uint64   // the audited team's supplier with 300 stores
	own        []uint64 // the audited team's live suppliers (not big)
	ownDeleted []uint64 // the audited team's deleted suppliers
	others     []uint64 // other teams' suppliers, deleted ones included
	bigStores  []uint64 // big's live stores
	ownStores  []uint64 // live stores of own[0]
}

func perfSetup(t *testing.T) perfBook {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	now := time.Now()

	// PERF_SCALE=n seeds n× the TEAMS (and so n× the suppliers and stores) while each team keeps its 200 —
	// the growth check: does one team's read slow down as OTHER teams grow?
	scale := 1
	if v, err := strconv.Atoi(os.Getenv("PERF_SCALE")); err == nil && v > 1 {
		scale = v
	}

	teams := perfTeams * scale
	total := perfSuppliers * scale
	t.Logf("SEED teams=%d suppliers=%d stores≈%d", teams, total, total*perfStoresPerSupplier+perfBigStores)
	deletedAt := now.Add(-24 * time.Hour)

	suppliers := make([]m.Supplier, 0, total)

	for i := range total {
		s := m.Supplier{
			TeamID: perfTeamBase + uint64(i%teams),
			Name: fmt.Sprintf("%s %s %s %d",
				perfPrefixes[perfPick(i, 1, len(perfPrefixes))],
				perfWords[perfPick(i, 2, len(perfWords))],
				perfWords[perfPick(i, 3, len(perfWords))],
				i),
			Contact:     fmt.Sprintf("08%010d", perfPick(i, 4, 1_000_000_000)),
			Address:     fmt.Sprintf("Jl. %s No. %d, %s", perfWords[perfPick(i, 5, len(perfWords))], i%200+1, perfCities[perfPick(i, 6, len(perfCities))]),
			Description: "seeded for the perf audit",
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		if i%20 == 19 {
			s.DeletedAt = &deletedAt
		}

		suppliers = append(suppliers, s)
	}

	san_perf.SeedRows(t, db, &suppliers)

	book := perfBook{db: db, probe: probe, team: perfTeamBase}

	for _, s := range suppliers {
		switch {
		case s.TeamID != book.team:
			book.others = append(book.others, s.ID)
		case s.DeletedAt != nil:
			book.ownDeleted = append(book.ownDeleted, s.ID)
		case book.big == 0:
			book.big = s.ID
		default:
			book.own = append(book.own, s.ID)
		}
	}

	stores := make([]m.SupplierChannel, 0, total*perfStoresPerSupplier+perfBigStores)
	n := 0
	addStore := func(supplierID uint64) {
		name := fmt.Sprintf("%s %s %s",
			perfWords[perfPick(n, 7, len(perfWords))],
			perfWords[perfPick(n, 8, len(perfWords))],
			perfSuffixes[perfPick(n, 9, len(perfSuffixes))])
		if n%997 == 0 {
			name = "Pusat Batik " + name
		}

		c := m.SupplierChannel{
			SupplierID:  supplierID,
			ChannelType: perfTypes[perfPick(n, 10, len(perfTypes))],
			Name:        name,
			URI:         fmt.Sprintf("https://store.example/%d", n),
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		if n%20 == 7 {
			c.DeletedAt = &deletedAt
		}

		stores = append(stores, c)
		n++
	}

	for _, s := range suppliers {
		if s.ID == book.big {
			continue
		}

		for range perfStoresPerSupplier {
			addStore(s.ID)
		}
	}

	for range perfBigStores {
		addStore(book.big)
	}

	san_perf.SeedRows(t, db, &stores)

	for _, c := range stores {
		if c.DeletedAt != nil {
			continue
		}

		switch c.SupplierID {
		case book.big:
			book.bigStores = append(book.bigStores, c.ID)
		case book.own[0]:
			book.ownStores = append(book.ownStores, c.ID)
		}
	}

	book.svc = supplier_v1.NewService(db, perfSellingTeams{}, nil)

	return book
}

func perfPage(n, limit uint32) *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: n, Limit: limit}
}

// perfRun warms once (i = -1), measures 5 runs, logs one PERF line per case with the medians, and EXPLAINs
// every statement of the last run that reads or writes a table.
func perfRun(t *testing.T, b perfBook, name string, call func(i int) error) {
	t.Helper()

	err := call(-1)
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)
	dbs := make([]time.Duration, 0, 5)
	counts := make([]int, 0, 5)
	var slowest san_perf.Query

	for i := range 5 {
		b.probe.Reset()

		var runErr error

		wall, dbTime := b.probe.Measure(func() {
			runErr = call(i)
		})
		if runErr != nil {
			t.Fatalf("%s run %d: %v", name, i, runErr)
		}

		walls = append(walls, wall)
		dbs = append(dbs, dbTime)
		counts = append(counts, b.probe.Count())

		for _, q := range b.probe.Queries() {
			if q.Duration > slowest.Duration {
				slowest = q
			}
		}
	}

	wall := san_perf.Median(walls)
	dbTime := san_perf.Median(dbs)
	maxWall := slices.Max(walls)
	maxDB := slices.Max(dbs)

	t.Logf("PERF %s median=%v db=%v go=%v max=%v maxdb=%v queries=%v slowest=%v :: %s",
		name,
		wall.Round(time.Microsecond),
		dbTime.Round(time.Microsecond),
		(wall - dbTime).Round(time.Microsecond),
		maxWall.Round(time.Microsecond),
		maxDB.Round(time.Microsecond),
		counts,
		slowest.Duration.Round(time.Microsecond),
		perfTrim(slowest.SQL, 140))

	// PERF_REPORT=1 also prints the probe's per-statement table of the last run.
	if os.Getenv("PERF_REPORT") != "" {
		b.probe.Report(t, name)
	}

	perfExplain(t, b, name)
}

var errPerfRollback = errors.New("perf: roll the explained write back")

// perfExplain runs EXPLAIN (ANALYZE, BUFFERS) on every table statement of the last run, on the test's own
// transaction. A write is explained inside a SAVEPOINT that is rolled back, so ANALYZE executing it leaves
// the seed exactly as it was.
func perfExplain(t *testing.T, b perfBook, name string) {
	t.Helper()

	quiet := b.db.Session(&gorm.Session{Logger: logger.Discard})

	for qi, q := range b.probe.Queries() {
		upper := strings.ToUpper(strings.TrimSpace(q.SQL))
		if !(strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "UPDATE") ||
			strings.HasPrefix(upper, "INSERT") || strings.HasPrefix(upper, "WITH")) {
			continue
		}

		var lines []string

		err := quiet.Transaction(func(tx *gorm.DB) error {
			scanErr := tx.Raw("EXPLAIN (ANALYZE, BUFFERS) " + q.SQL).Scan(&lines).Error
			if scanErr != nil {
				return scanErr
			}

			return errPerfRollback
		})
		if err != nil && !errors.Is(err, errPerfRollback) {
			t.Fatalf("explain %s #%d: %v\n%s", name, qi, err, q.SQL)
		}

		t.Logf("SQL %s #%d (%v, %d rows) | %s", name, qi, q.Duration.Round(time.Microsecond), q.Rows, q.SQL)

		for _, line := range lines {
			t.Logf("PLAN %s #%d | %s", name, qi, line)
		}
	}
}

func perfTrim(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}

	return s[:n] + "…"
}
