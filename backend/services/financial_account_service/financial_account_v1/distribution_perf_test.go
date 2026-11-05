//go:build perfaudit

// The same reads at a PRODUCTION-LIKE SPREAD. The default seed gives the audited team 36% of the daily rows
// and the busy account 40% of the log, so a Seq Scan there may be the planner rightly reading a third of a
// table. Here 350 000 more rows of OTHER teams go into each table — the audited team and the busy account fall
// to ~5% — and the plans are read again.
//
//	go test -tags perfaudit -run TestPerf_Spread -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	fa "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

func TestPerf_Spread(t *testing.T) {
	b := perfSetup(t)
	now := time.Now()

	var others []m.FinancialAccount
	if err := b.db.Where("team_id > ?", b.team).Order("id").Find(&others).Error; err != nil {
		t.Fatalf("others: %v", err)
	}

	logs := make([]m.FinancialAccountLog, 0, 350_000)
	for i := range 350_000 {
		a := others[i%len(others)]
		logs = append(logs, m.FinancialAccountLog{
			TeamID: a.TeamID, AccountID: a.ID, ChangeType: m.ChangeRestock, Change: -1_000, BalanceAfter: 1,
			OccurredAt: now.AddDate(0, 0, -(i % perfDays)), CreatedAt: now,
		})
	}

	san_perf.SeedRows(t, b.db, &logs)

	// Other teams' years, on accounts the default seed left without daily rows.
	var dailyAccounts []uint64
	b.db.Raw(`SELECT DISTINCT account_id FROM financial_account_daily_reports`).Scan(&dailyAccounts)

	has := map[uint64]bool{}
	for _, id := range dailyAccounts {
		has[id] = true
	}

	dailies := make([]m.FinancialAccountDailyReport, 0, 350_000)
	for _, a := range others {
		if has[a.ID] || len(dailies) >= 350_000-perfDays {
			continue
		}

		for d := range perfDays {
			dailies = append(dailies, m.FinancialAccountDailyReport{
				Day: time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -d), AccountID: a.ID, TeamID: a.TeamID,
				MetricColumns: m.MetricColumns{Restock: -1_000, Change: -1_000, CloseBalance: float64(-d * 1_000)}, LastUpdated: now,
			})
		}
	}

	san_perf.SeedRows(t, b.db, &dailies)

	perfRun(t, b, "Spread/FinancialAccountLogList/limit=20", func(int) error {
		_, err := b.svc.FinancialAccountLogList(context.Background(), connect.NewRequest(&fa.FinancialAccountLogListRequest{
			TeamId: b.team, Filter: &fa.FinancialAccountLogListFilter{AccountId: b.busy}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		return err
	})

	for _, c := range []struct {
		name  string
		from  int
		group analytic_basev1.GroupType
	}{
		{"account-365d", 364, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT},
		{"account-30d", 29, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT},
		{"daily-30d", 29, analytic_basev1.GroupType_GROUP_TYPE_DAILY},
	} {
		perfRun(t, b, "Spread/MetricSearch/"+c.name, func(int) error {
			_, err := b.svc.MetricSearch(context.Background(), connect.NewRequest(&fa.MetricSearchRequest{
				TeamId: b.team, GroupBy: c.group, Filters: []*analytic_basev1.FilterItem{window(c.from, 0)},
				Sort: &analytic_basev1.MetricSort{MetricId: metricChanges, Field: "change"},
				Page: &analytic_basev1.PaginationFilter{Limit: 20},
			}))
			return err
		})
	}
}
