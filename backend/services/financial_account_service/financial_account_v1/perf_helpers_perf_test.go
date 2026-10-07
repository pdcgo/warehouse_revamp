//go:build perfaudit

// Shared seeding and measuring for the financial_account_service performance audits (the
// audit-rpc-performance skill). Each RPC's probe is in its own <rpc>_perf_test.go.
//
//	go test -tags perfaudit -run TestPerf_ -v ./backend/services/financial_account_service/financial_account_v1/
//
// Volumes (the skill's table): financial_accounts is an ENTITY table — 10 000 rows, 50 per team over 200
// teams; financial_account_logs is a LOG — 50 000 rows, 20 000 of them on the one busy account a statement
// is read from; financial_account_daily_reports is a LOG — the audited team's 50 accounts × 365 days, plus
// the other teams' to ~50 000.
package financial_account_v1_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

const (
	perfTeams           = 200
	perfAccountsPerTeam = 50
	perfLogs            = 50_000
	perfBusyLogs        = 20_000
	perfDays            = 365
	perfTeamBase        = 20_000
)

// anyShop accepts every shop — the perf audit measures the account's own queries, not the shop's.
type anyShop struct{}

func (anyShop) ShopOfTeam(context.Context, uint64, uint64) error { return nil }

type perfBook struct {
	db    *gorm.DB
	probe *san_perf.Probe
	svc   *financial_account_v1.Service
	team  uint64
	// The audited team's accounts, by role.
	accounts  []m.FinancialAccount
	busy      uint64   // 20 000 rows — the statement under test
	unknowns  []uint64 // per-run fixtures for Identify
	zeros     []uint64 // per-run fixtures for Archive
	archived  []uint64 // per-run fixtures for Restore
	shopsBase uint64
}

func perfSetup(t *testing.T) perfBook {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	now := time.Now()
	providers := []string{m.ProviderBCA, m.ProviderBNI, m.ProviderJago, m.ProviderShopeePay}

	accounts := make([]m.FinancialAccount, 0, perfTeams*perfAccountsPerTeam)
	for team := range perfTeams {
		for i := range perfAccountsPerTeam {
			status := m.StatusActive
			if i%10 == 9 {
				status = m.StatusArchived
			}

			accounts = append(accounts, m.FinancialAccount{
				TeamID:        uint64(perfTeamBase + team),
				Type:          m.TypeBankAccount,
				Provider:      providers[i%len(providers)],
				Status:        status,
				AccountNumber: fmt.Sprintf("P%03d%04d", team, i),
				Name:          fmt.Sprintf("Account %03d-%02d", team, i),
				HolderName:    "PT Perf",
				Balance:       float64(1_000_000 + i*1_000),
				CreatedAt:     now,
				UpdatedAt:     now,
			})
		}
	}

	// The per-run fixtures of the audited team: 6 unknown, 6 at zero, 6 archived (warm-up + 5 runs).
	team := uint64(perfTeamBase)
	for i := range 6 {
		accounts = append(accounts,
			m.FinancialAccount{TeamID: team, Type: m.TypeUnknown, Provider: m.ProviderUnknown, Status: m.StatusActive, Name: fmt.Sprintf("Unknown — shop #%d", 90_000+i), Balance: 50_000, CreatedAt: now, UpdatedAt: now},
			m.FinancialAccount{TeamID: team, Type: m.TypeCash, Provider: m.ProviderCash, Status: m.StatusActive, Name: fmt.Sprintf("Zero %d", i), CreatedAt: now, UpdatedAt: now},
			m.FinancialAccount{TeamID: team, Type: m.TypeCash, Provider: m.ProviderCash, Status: m.StatusArchived, Name: fmt.Sprintf("Closed %d", i), CreatedAt: now, UpdatedAt: now},
		)
	}

	san_perf.SeedRows(t, db, &accounts)

	book := perfBook{db: db, probe: probe, team: team, shopsBase: 70_000}

	for _, a := range accounts {
		if a.TeamID != team {
			continue
		}

		switch {
		case a.Type == m.TypeUnknown:
			book.unknowns = append(book.unknowns, a.ID)
		case strings.HasPrefix(a.Name, "Zero"):
			book.zeros = append(book.zeros, a.ID)
		case strings.HasPrefix(a.Name, "Closed"):
			book.archived = append(book.archived, a.ID)
		default:
			book.accounts = append(book.accounts, a)
		}
	}

	book.busy = book.accounts[0].ID

	// Operational marks and shop links: the first five accounts of every team, two shops on each of the first two.
	marks := []m.OperationalAccount{}
	links := []m.ShopAccount{}

	for i, a := range accounts {
		if i%perfAccountsPerTeam < 5 && a.Status == m.StatusActive && a.Type == m.TypeBankAccount {
			marks = append(marks, m.OperationalAccount{TeamID: a.TeamID, AccountID: a.ID, CreatedAt: now, UpdatedAt: now})
		}

		if i%perfAccountsPerTeam < 2 && a.Type == m.TypeBankAccount {
			for s := range 2 {
				links = append(links, m.ShopAccount{TeamID: a.TeamID, ShopID: uint64(10_000_000 + i*2 + s), AccountID: a.ID, CreatedAt: now, UpdatedAt: now})
			}
		}
	}

	for i, id := range book.unknowns {
		links = append(links, m.ShopAccount{TeamID: team, ShopID: uint64(90_000 + i), AccountID: id, CreatedAt: now, UpdatedAt: now})
	}

	san_perf.SeedRows(t, db, &marks)
	san_perf.SeedRows(t, db, &links)

	// The log: 20 000 rows on the busy account, the rest spread over every other account, a year deep.
	types := []string{m.ChangeWithdrawal, m.ChangeRestock, m.ChangeExpense, m.ChangeTransfer, m.ChangeCapital, m.ChangeAdsExpense}
	logs := make([]m.FinancialAccountLog, 0, perfLogs)

	for i := range perfLogs {
		account := accounts[(i*7919)%(perfTeams*perfAccountsPerTeam)]
		if i < perfBusyLogs {
			account = book.accounts[0]
		}

		logs = append(logs, m.FinancialAccountLog{
			TeamID:       account.TeamID,
			AccountID:    account.ID,
			ChangeType:   types[i%len(types)],
			Change:       float64((i%11 - 5) * 10_000),
			BalanceAfter: float64(1_000_000 + i),
			Description:  "seeded for the perf audit",
			OccurredAt:   now.AddDate(0, 0, -(i % perfDays)),
			CreatedAt:    now,
		})
	}

	san_perf.SeedRows(t, db, &logs)

	// The daily rows: every account of the audited team, every day of the year; then other teams' accounts.
	dailies := make([]m.FinancialAccountDailyReport, 0, perfLogs)
	addYear := func(a m.FinancialAccount) {
		for d := range perfDays {
			dailies = append(dailies, m.FinancialAccountDailyReport{
				Day:           time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -d),
				AccountID:     a.ID,
				TeamID:        a.TeamID,
				MetricColumns: m.MetricColumns{Withdrawal: 10_000, Restock: -5_000, Change: 5_000, OpenBalance: float64(1_000_000 - d*5_000), CloseBalance: float64(1_005_000 - d*5_000)},
				LastUpdated:   now,
			})
		}
	}

	for _, a := range book.accounts {
		addYear(a)
	}

	for i := perfAccountsPerTeam; len(dailies) < perfLogs-perfDays && i < len(accounts); i += 37 {
		addYear(accounts[i])
	}

	san_perf.SeedRows(t, db, &dailies)

	book.svc = financial_account_v1.NewService(db, anyShop{})

	return book
}

// perfRun warms once (i = -1), then measures 5 runs, logs one PERF line per run and the median, and EXPLAINs
// the slowest SELECT of the last run.
func perfRun(t *testing.T, b perfBook, name string, call func(i int) error) {
	t.Helper()

	err := call(-1)
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)
	dbs := make([]time.Duration, 0, 5)
	count := 0

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
		count = b.probe.Count()
	}

	wall := san_perf.Median(walls)
	dbTime := san_perf.Median(dbs)

	slowest := san_perf.Query{}
	for _, q := range b.probe.Queries() {
		if q.Duration > slowest.Duration {
			slowest = q
		}
	}

	t.Logf("PERF %s median=%v db=%v go=%v queries=%d slowest=%v",
		name, wall.Round(time.Microsecond), dbTime.Round(time.Microsecond), (wall - dbTime).Round(time.Microsecond), count, slowest.Duration.Round(time.Microsecond))

	// PERF_REPORT=1 also prints the probe's per-statement table of the last run.
	if os.Getenv("PERF_REPORT") != "" {
		b.probe.Report(t, name)
	}

	explainSlowestSelect(t, b, name)
}

// explainSlowestSelect EXPLAINs the slowest read of the last run on the test's own transaction, and logs only
// what the skill reads a plan for — scans, sorts, loops and the execution time.
func explainSlowestSelect(t *testing.T, b perfBook, name string) {
	t.Helper()

	slowest := san_perf.Query{}
	for _, q := range b.probe.Queries() {
		sql := strings.TrimSpace(strings.ToUpper(q.SQL))
		if (strings.HasPrefix(sql, "SELECT") || strings.HasPrefix(sql, "WITH")) && !strings.Contains(sql, "FOR UPDATE") && q.Duration > slowest.Duration {
			slowest = q
		}
	}

	if slowest.SQL == "" {
		return
	}

	var lines []string

	err := b.db.Session(&gorm.Session{Logger: logger.Discard}).Raw("EXPLAIN (ANALYZE, BUFFERS) " + slowest.SQL).Scan(&lines).Error
	if err != nil {
		t.Fatalf("explain %s: %v", name, err)
	}

	for _, line := range lines {
		if strings.Contains(line, "Seq Scan") || strings.Contains(line, "Sort Method") ||
			strings.Contains(line, "Index") || strings.Contains(line, "Execution Time") ||
			strings.Contains(line, "loops=") && strings.Contains(line, "Nested Loop") {
			t.Logf("PLAN %s | %s", name, strings.TrimSpace(line))
		}
	}
}
