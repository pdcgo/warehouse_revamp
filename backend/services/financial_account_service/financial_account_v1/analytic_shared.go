package financial_account_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// THE REPORTS' READ SIDE — settlement's delivery (analytics-are-delivered-the-settlement-way), read from
// `financial_account_daily_reports`, one row per account per day (the-daily-row-is-one-account-one-day).
//
// A balance is per ACCOUNT: the balance at a date is the account's last row at or before it, and a team's is
// the sum of its accounts'. A window's movement is the sum of its days.

var (
	errRangeBackwards = connect.NewError(connect.CodeInvalidArgument, errors.New("start_date must not be after end_date"))
	errBadTimeframe   = connect.NewError(connect.CodeInvalidArgument, errors.New("unknown timeframe"))
	errBadGroup       = connect.NewError(connect.CodeInvalidArgument, errors.New("unknown group_type"))
)

// parseRange reads a report window — both ends required and inclusive, Jakarta dates.
func parseRange(r *financial_accountv1.AnalyticDateRange) (time.Time, time.Time, error) {
	start, err := time.Parse(dateLayout, r.GetStartDate())
	if err != nil {
		return time.Time{}, time.Time{}, errBadDay
	}

	end, err := time.Parse(dateLayout, r.GetEndDate())
	if err != nil {
		return time.Time{}, time.Time{}, errBadDay
	}

	if start.After(end) {
		return time.Time{}, time.Time{}, errRangeBackwards
	}

	return start, end, nil
}

// movementSums renders "COALESCE(SUM(r.expense), 0) AS expense, …, … AS change".
func movementSums(alias string) string {
	parts := make([]string, 0, len(changeTypes)+1)
	for _, column := range append(append([]string{}, changeTypes...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s.%s), 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}

// movementsFrom renders "COALESCE(m.expense, 0) AS expense, …" — a joined movement row, zero when absent.
func movementsFrom(alias string) string {
	parts := make([]string, 0, len(changeTypes)+1)
	for _, column := range append(append([]string{}, changeTypes...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(%s.%s, 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}

// dateArray renders a Postgres date array literal. ⚠ A literal cast in SQL, not a Go slice: GORM expands a
// slice into a comma list, right for IN and wrong for an array parameter.
func dateArray(days []time.Time) string {
	parts := make([]string, 0, len(days))
	for _, day := range days {
		parts = append(parts, day.Format(dateLayout))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

// bucket is one point of a series: `at` is its own first day, from/to that bucket clipped to the window.
type bucket struct {
	at   time.Time
	from time.Time
	to   time.Time
}

// timeBuckets lays out EVERY bucket of the window, quiet ones included — a quiet day still has a balance.
// Capped per grain: 366 days, 60 months, 20 years.
func timeBuckets(timeframe financial_accountv1.AnalyticTimeframe, start, end time.Time) ([]bucket, error) {
	var (
		first time.Time
		step  func(time.Time) time.Time
		limit int
	)

	switch timeframe {
	case financial_accountv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY:
		first = start
		step = func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }
		limit = 366
	case financial_accountv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY:
		first = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
		step = func(t time.Time) time.Time { return t.AddDate(0, 1, 0) }
		limit = 60
	case financial_accountv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_YEARLY:
		first = time.Date(start.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		step = func(t time.Time) time.Time { return t.AddDate(1, 0, 0) }
		limit = 20
	default:
		return nil, errBadTimeframe
	}

	out := []bucket{}

	for at := first; !at.After(end); at = step(at) {
		if len(out) == limit {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("the window holds more than %d points — narrow it or read a coarser timeframe", limit))
		}

		from := at
		if from.Before(start) {
			from = start
		}

		to := step(at).AddDate(0, 0, -1)
		if to.After(end) {
			to = end
		}

		out = append(out, bucket{at: at, from: from, to: to})
	}

	return out, nil
}

// accountWindow is one account's figures over a window: its movement by type, whether each type moved at all
// (a team's transfers net to zero and still moved), and its balance at the window's end.
type accountWindow struct {
	AccountID uint64
	Provider  string
	m.MetricColumns

	MovedExpense        bool
	MovedAdsExpense     bool
	MovedAdjustment     bool
	MovedWithdrawal     bool
	MovedRestock        bool
	MovedOpeningBalance bool
	MovedTransfer       bool
	MovedTeamPayment    bool
	MovedCapital        bool
}

// windowByAccount reads every account of the team that HAS A BALANCE by the window's end — a row at or before
// it — with its movement inside the window. Archived accounts included: their past happened
// (account-grouped-joins-the-metrics). ONE statement for the whole team.
func windowByAccount(ctx context.Context, db *gorm.DB, teamID uint64, start, end time.Time) ([]accountWindow, error) {
	moved := make([]string, 0, len(changeTypes))
	for _, column := range changeTypes {
		moved = append(moved, fmt.Sprintf("COALESCE(BOOL_OR(r.%[1]s <> 0), false) AS moved_%[1]s", column))
	}

	query := fmt.Sprintf(`
WITH win AS (
    SELECT r.account_id, %[1]s, %[2]s
    FROM financial_account_daily_reports r
    WHERE r.team_id = @team AND r.day BETWEEN CAST(@start AS date) AND CAST(@end AS date)
    GROUP BY r.account_id
), closing AS (
    SELECT DISTINCT ON (r.account_id) r.account_id, r.close_balance
    FROM financial_account_daily_reports r
    WHERE r.team_id = @team AND r.day <= CAST(@end AS date)
    ORDER BY r.account_id, r.day DESC
)
SELECT a.id AS account_id, a.provider, %[3]s, closing.close_balance, %[4]s
FROM financial_accounts a
JOIN closing ON closing.account_id = a.id
LEFT JOIN win ON win.account_id = a.id
WHERE a.team_id = @team
ORDER BY a.id`,
		movementSums("r"), strings.Join(moved, ", "), movementsFrom("win"), movedFrom("win"))

	rows := []accountWindow{}

	err := db.WithContext(ctx).Raw(query, map[string]any{
		"team":  teamID,
		"start": start.Format(dateLayout),
		"end":   end.Format(dateLayout),
	}).Scan(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	for i := range rows {
		rows[i].OpenBalance = rows[i].CloseBalance - rows[i].Change
	}

	return rows, nil
}

func movedFrom(alias string) string {
	parts := make([]string, 0, len(changeTypes))
	for _, column := range changeTypes {
		parts = append(parts, fmt.Sprintf("COALESCE(%s.moved_%s, false) AS moved_%s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}

// column reads one change type's figure out of a metric.
func column(c m.MetricColumns, changeType string) float64 {
	switch changeType {
	case m.ChangeExpense:
		return c.Expense
	case m.ChangeAdsExpense:
		return c.AdsExpense
	case m.ChangeAdjustment:
		return c.Adjustment
	case m.ChangeWithdrawal:
		return c.Withdrawal
	case m.ChangeRestock:
		return c.Restock
	case m.ChangeOpeningBalance:
		return c.OpeningBalance
	case m.ChangeTransfer:
		return c.Transfer
	case m.ChangeTeamPayment:
		return c.TeamPayment
	case m.ChangeCapital:
		return c.Capital
	}

	return 0
}

// onlyColumn is a metric holding one change type's figure and nothing else — a CHANGE_TYPE group's: its
// column and its change, and no balance, which belongs to an account and not to a type.
func onlyColumn(changeType string, v float64) m.MetricColumns {
	c := m.MetricColumns{Change: v}

	switch changeType {
	case m.ChangeExpense:
		c.Expense = v
	case m.ChangeAdsExpense:
		c.AdsExpense = v
	case m.ChangeAdjustment:
		c.Adjustment = v
	case m.ChangeWithdrawal:
		c.Withdrawal = v
	case m.ChangeRestock:
		c.Restock = v
	case m.ChangeOpeningBalance:
		c.OpeningBalance = v
	case m.ChangeTransfer:
		c.Transfer = v
	case m.ChangeTeamPayment:
		c.TeamPayment = v
	case m.ChangeCapital:
		c.Capital = v
	}

	return c
}

func (w accountWindow) moved(changeType string) bool {
	switch changeType {
	case m.ChangeExpense:
		return w.MovedExpense
	case m.ChangeAdsExpense:
		return w.MovedAdsExpense
	case m.ChangeAdjustment:
		return w.MovedAdjustment
	case m.ChangeWithdrawal:
		return w.MovedWithdrawal
	case m.ChangeRestock:
		return w.MovedRestock
	case m.ChangeOpeningBalance:
		return w.MovedOpeningBalance
	case m.ChangeTransfer:
		return w.MovedTransfer
	case m.ChangeTeamPayment:
		return w.MovedTeamPayment
	case m.ChangeCapital:
		return w.MovedCapital
	}

	return false
}

func add(a, b m.MetricColumns) m.MetricColumns {
	return m.MetricColumns{
		Expense:        a.Expense + b.Expense,
		AdsExpense:     a.AdsExpense + b.AdsExpense,
		Adjustment:     a.Adjustment + b.Adjustment,
		Withdrawal:     a.Withdrawal + b.Withdrawal,
		Restock:        a.Restock + b.Restock,
		OpeningBalance: a.OpeningBalance + b.OpeningBalance,
		Transfer:       a.Transfer + b.Transfer,
		TeamPayment:    a.TeamPayment + b.TeamPayment,
		Capital:        a.Capital + b.Capital,
		Change:         a.Change + b.Change,
		OpenBalance:    a.OpenBalance + b.OpenBalance,
		CloseBalance:   a.CloseBalance + b.CloseBalance,
	}
}

// group is one ranked key with its window metric.
type group struct {
	key    *financial_accountv1.AnalyticGroupKey
	sortID string
	metric m.MetricColumns
}

// groupsOf turns the per-account window into the groups a grouping asks for.
func groupsOf(groupType financial_accountv1.AnalyticGroupType, rows []accountWindow) ([]group, error) {
	switch groupType {
	case financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_ACCOUNT:
		out := make([]group, 0, len(rows))
		for _, r := range rows {
			out = append(out, group{
				key:    &financial_accountv1.AnalyticGroupKey{Key: &financial_accountv1.AnalyticGroupKey_AccountId{AccountId: r.AccountID}},
				sortID: fmt.Sprintf("a%020d", r.AccountID),
				metric: r.MetricColumns,
			})
		}

		return out, nil

	case financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_PROVIDER:
		// Read from the account NOW, never copied onto the daily row — an unknown account filled in moves its
		// history to its new provider.
		byProvider := map[string]m.MetricColumns{}
		order := []string{}

		for _, r := range rows {
			if _, seen := byProvider[r.Provider]; !seen {
				order = append(order, r.Provider)
			}

			byProvider[r.Provider] = add(byProvider[r.Provider], r.MetricColumns)
		}

		out := make([]group, 0, len(order))
		for _, p := range order {
			out = append(out, group{
				key:    &financial_accountv1.AnalyticGroupKey{Key: &financial_accountv1.AnalyticGroupKey_Provider{Provider: providerEnum[p]}},
				sortID: "p" + p,
				metric: byProvider[p],
			})
		}

		return out, nil

	case financial_accountv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_CHANGE_TYPE:
		out := []group{}

		for _, t := range changeTypes {
			sum := 0.0
			moved := false

			for _, r := range rows {
				sum += column(r.MetricColumns, t)
				moved = moved || r.moved(t)
			}

			// A type that moved nothing in the window is no group of it.
			if !moved {
				continue
			}

			out = append(out, group{
				key:    &financial_accountv1.AnalyticGroupKey{Key: &financial_accountv1.AnalyticGroupKey_ChangeType{ChangeType: changeTypeEnum[t]}},
				sortID: "t" + t,
				metric: onlyColumn(t, sum),
			})
		}

		return out, nil
	}

	return nil, errBadGroup
}

// sameKey compares two group keys by value.
func sameKey(a, b *financial_accountv1.AnalyticGroupKey) bool {
	switch ka := a.GetKey().(type) {
	case *financial_accountv1.AnalyticGroupKey_AccountId:
		kb, ok := b.GetKey().(*financial_accountv1.AnalyticGroupKey_AccountId)
		return ok && ka.AccountId == kb.AccountId
	case *financial_accountv1.AnalyticGroupKey_Provider:
		kb, ok := b.GetKey().(*financial_accountv1.AnalyticGroupKey_Provider)
		return ok && ka.Provider == kb.Provider
	case *financial_accountv1.AnalyticGroupKey_ChangeType:
		kb, ok := b.GetKey().(*financial_accountv1.AnalyticGroupKey_ChangeType)
		return ok && ka.ChangeType == kb.ChangeType
	}

	return false
}
