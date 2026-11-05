package financial_account_v1

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// THE FINANCE METRICS' READ SIDE (financial-accounts-serve-their-changes-and-their-types) — read from
// `financial_account_daily_reports`, one row per account per day (the-daily-row-is-one-account-one-day).
//
// A BALANCE IS ONE RUNNING SUM (the-balance-series-is-a-running-sum): each account's balance BEFORE the window is read
// once — its last daily row before the first day, one probe of the (account_id, day) index — and every figure after it
// is that balance plus the window's changes, added in date order. No period re-reads history.
//
// The scope is always the request's team, the root team's included: every team reads its own accounts and never
// another's (every-team-reads-its-own-finance).

// financeMetric is one of the two Finance metrics: its message and the option read off it — so the id, the filters,
// the groups and the sortable fields are stated once, in the proto.
type financeMetric struct {
	desc   protoreflect.MessageDescriptor
	option *analytic_basev1.MetricOption
}

func newFinanceMetric(message proto.Message) *financeMetric {
	desc := message.ProtoReflect().Descriptor()

	return &financeMetric{desc: desc, option: san_metric.OptionOf(desc)}
}

var (
	// The statement: opening, the nine change types, the net, closing.
	metricChanges = newFinanceMetric(&financial_accountv1.AccountChangeMetric{})
	// The breakdown: one amount per change type.
	metricTypes = newFinanceMetric(&financial_accountv1.AccountChangeTypeMetric{})

	financeMetrics = []*financeMetric{metricChanges, metricTypes}
)

func financeMetricByID(metricID string) (*financeMetric, error) {
	for _, metric := range financeMetrics {
		if metric.option.GetMetricId() == metricID {
			return metric, nil
		}
	}

	return nil, invalidMetric("this service does not serve %q", metricID)
}

func invalidMetric(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}

var errMetricRangeBackwards = connect.NewError(connect.CodeInvalidArgument, errors.New("date_min must not be after date_max"))

// ── the figures of one key ───────────────────────────────────────────────────────────────────────

// figures is one key's window: the nine change types and their net, and the balance at its two edges — OpenBalance at
// the key's first day in the window, CloseBalance = OpenBalance + Change at its last.
type figures = m.MetricColumns

// changesOf is a key's Account changes. ⚠ The change type OPENING_BALANCE is `account_opening` on the metric; its
// `opening_balance` is the position.
func changesOf(f figures) *financial_accountv1.AccountChangeMetric {
	return &financial_accountv1.AccountChangeMetric{
		OpeningBalance: f.OpenBalance,
		Expense:        f.Expense,
		AdsExpense:     f.AdsExpense,
		Adjustment:     f.Adjustment,
		Withdrawal:     f.Withdrawal,
		Restock:        f.Restock,
		AccountOpening: f.OpeningBalance,
		Transfer:       f.Transfer,
		TeamPayment:    f.TeamPayment,
		Capital:        f.Capital,
		Change:         f.Change,
		ClosingBalance: f.CloseBalance,
	}
}

// typesOf is a key's Change types: its net change — for a CHANGE_TYPE key, that type's own figure (onlyColumn).
func typesOf(f figures) *financial_accountv1.AccountChangeTypeMetric {
	return &financial_accountv1.AccountChangeTypeMetric{Amount: f.Change}
}

// messageOf is the metric's answer for one key, as a message — what a search ranks by, by the field's descriptor.
func (metric *financeMetric) messageOf(f figures) proto.Message {
	if metric == metricChanges {
		return changesOf(f)
	}

	return typesOf(f)
}

// column reads one change type's figure.
func column(c figures, changeType string) float64 {
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

// onlyColumn is a CHANGE_TYPE key's figures: that type's sum as its `change`, and no balance — a balance belongs to an
// account, not to a type.
func onlyColumn(v float64) figures {
	return figures{Change: v}
}

// add sums two keys' figures — movements and positions alike: positions add up across ACCOUNTS (a provider, the team),
// never across periods (a-position-is-its-own-stat-type).
func add(a, b figures) figures {
	return figures{
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

// ── the request ──────────────────────────────────────────────────────────────────────────────────

// metricFilters is what a request narrows the figures to: the window, and the accounts (finance-filters-by-account).
type metricFilters struct {
	start, end time.Time
	accounts   []uint64
}

// parseMetricFilters reads a request's filters against every asked metric. Each case's field number IS its FilterType
// (a-filter-names-one-id-and-shares-its-types-number). A filter a metric does not support, a repeated one, or a missing
// required one is InvalidArgument.
func parseMetricFilters(items []*analytic_basev1.FilterItem, metrics []*financeMetric) (metricFilters, error) {
	var filters metricFilters

	seen := map[analytic_basev1.FilterType]bool{}

	for _, item := range items {
		reflected := item.ProtoReflect()

		set := reflected.WhichOneof(reflected.Descriptor().Oneofs().ByName("f"))
		if set == nil {
			return filters, invalidMetric("a filter item carries no filter")
		}

		kind := analytic_basev1.FilterType(set.Number())

		for _, metric := range metrics {
			if !slices.Contains(metric.option.GetSupportedFilters(), kind) {
				return filters, invalidMetric("%s does not support %s", metric.option.GetMetricId(), kind)
			}
		}

		if seen[kind] {
			return filters, invalidMetric("%s is sent twice", kind)
		}

		seen[kind] = true

		switch kind {
		case analytic_basev1.FilterType_FILTER_TYPE_DATE_RANGE:
			window := item.GetDateRangeFilter()

			start, err := time.Parse(dateLayout, window.GetDateMin())
			if err != nil {
				return filters, invalidMetric("date_min is not a day: %q", window.GetDateMin())
			}

			end, err := time.Parse(dateLayout, window.GetDateMax())
			if err != nil {
				return filters, invalidMetric("date_max is not a day: %q", window.GetDateMax())
			}

			if start.After(end) {
				return filters, errMetricRangeBackwards
			}

			// A YEAR AT MOST, both days counted (a-metric-reads-at-most-a-year).
			err = san_metric.CheckRange(start, end)
			if err != nil {
				return filters, connect.NewError(connect.CodeInvalidArgument, err)
			}

			filters.start, filters.end = start, end
		case analytic_basev1.FilterType_FILTER_TYPE_ACCOUNT:
			filters.accounts = item.GetAccountFilter().GetAccountIds()
		}
	}

	for _, metric := range metrics {
		for _, required := range metric.option.GetRequiredFilters() {
			if !seen[required] {
				return filters, invalidMetric("%s requires %s", metric.option.GetMetricId(), required)
			}
		}
	}

	return filters, nil
}

// checkGroup refuses a GroupType some asked metric does not list — Account changes under CHANGE_TYPE, so it is greyed.
func checkGroup(group analytic_basev1.GroupType, metrics []*financeMetric) error {
	for _, metric := range metrics {
		if !slices.Contains(metric.option.GetSupportedGroupBy(), group) {
			return invalidMetric("%s cannot be grouped by %s", metric.option.GetMetricId(), group)
		}
	}

	return nil
}

func isTimeGroup(group analytic_basev1.GroupType) bool {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return true
	default:
		return false
	}
}

// ── periods ──────────────────────────────────────────────────────────────────────────────────────

// periodStart is the first day of the period `day` falls in — what a period's key must be. A week runs Monday to
// Sunday (a-week-is-monday-to-sunday-jakarta); the report's days are already Jakarta days.
func periodStart(group analytic_basev1.GroupType, day time.Time) time.Time {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		back := (int(day.Weekday()) + 6) % 7 // Monday is 0 days back, Sunday 6

		return day.AddDate(0, 0, -back)
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, time.UTC)
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return time.Date(day.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	default:
		return day
	}
}

// periodEnd is the last day of the period that starts on `start`.
func periodEnd(group analytic_basev1.GroupType, start time.Time) time.Time {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		return start.AddDate(0, 0, 6)
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return start.AddDate(0, 1, -1)
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return start.AddDate(1, 0, -1)
	default:
		return start
	}
}

// ── the reads ────────────────────────────────────────────────────────────────────────────────────

// accountScope renders the WHERE over `financial_accounts a`: the caller's team, and the Account filter.
func accountScope(teamID uint64, filters metricFilters) string {
	return scopeOn("a", "id", teamID, filters)
}

// reportScope renders the same over `financial_account_daily_reports r` — its own team_id, so a window's movement is
// one range of the (team_id, day) index, no join.
func reportScope(teamID uint64, filters metricFilters) string {
	return scopeOn("r", "account_id", teamID, filters)
}

// scopeOn writes the team and the accounts on a table's columns. Every value is a parsed id, so it is a literal.
func scopeOn(alias, idColumn string, teamID uint64, filters metricFilters) string {
	scope := fmt.Sprintf("%s.team_id = %d", alias, teamID)

	if len(filters.accounts) > 0 {
		ids := make([]string, 0, len(filters.accounts))
		for _, id := range filters.accounts {
			ids = append(ids, fmt.Sprintf("%d", id))
		}

		scope += fmt.Sprintf(" AND %s.%s IN (%s)", alias, idColumn, strings.Join(ids, ", "))
	}

	return scope
}

// sqlDay is a day as a SQL literal — formatted from a parsed time, so only digits and dashes reach SQL.
func sqlDay(day time.Time) string {
	return "DATE '" + day.Format(dateLayout) + "'"
}

// movementSums renders "COALESCE(SUM(r.expense), 0) AS expense, …, … AS change".
func movementSums(alias string) string {
	parts := make([]string, 0, len(changeTypes)+1)
	for _, c := range append(slices.Clone(changeTypes), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s.%s), 0) AS %s", alias, c, c))
	}

	return strings.Join(parts, ", ")
}

// accountWindow is one account's window: its provider now, its figures, and whether each type moved at all (a team's
// transfers net to zero and still moved).
type accountWindow struct {
	AccountID uint64
	Provider  string
	// ⚠ The models' exported type, embedded by name: GORM leaves an embedded field of an unexported name at zero.
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

// byAccount reads every account in scope that HAS A BALANCE by the window's end — a daily row at or before it, a quiet
// account included — in ONE statement: per account, its balance before the window (the last row before the first day,
// one backward index probe) and its window's movement (one index range). Archived accounts included: their past happened.
func (s *Service) byAccount(ctx context.Context, teamID uint64, filters metricFilters) ([]accountWindow, error) {
	moved := make([]string, 0, len(changeTypes))
	for _, c := range changeTypes {
		moved = append(moved, fmt.Sprintf("COALESCE(BOOL_OR(r.%[1]s <> 0), false) AS moved_%[1]s", c))
	}

	carried := make([]string, 0, len(changeTypes)*2+1)
	for _, c := range append(slices.Clone(changeTypes), "change") {
		carried = append(carried, "w."+c)
	}

	for _, c := range changeTypes {
		carried = append(carried, "w.moved_"+c)
	}

	query := fmt.Sprintf(`
SELECT a.id AS account_id, a.provider, COALESCE(o.close_balance, 0) AS open_balance, %[1]s
FROM financial_accounts a
LEFT JOIN LATERAL (
    SELECT r.close_balance
    FROM financial_account_daily_reports r
    WHERE r.account_id = a.id AND r.day < %[2]s
    ORDER BY r.day DESC
    LIMIT 1
) o ON TRUE
CROSS JOIN LATERAL (
    SELECT COUNT(*) AS days, %[3]s, %[4]s
    FROM financial_account_daily_reports r
    WHERE r.account_id = a.id AND r.day BETWEEN %[2]s AND %[5]s
) w
WHERE %[6]s AND (o.close_balance IS NOT NULL OR w.days > 0)
ORDER BY a.id`,
		strings.Join(carried, ", "), sqlDay(filters.start), movementSums("r"), strings.Join(moved, ", "),
		sqlDay(filters.end), accountScope(teamID, filters))

	rows := []accountWindow{}

	err := s.db.WithContext(ctx).Raw(query).Scan(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	for i := range rows {
		rows[i].CloseBalance = rows[i].OpenBalance + rows[i].Change
	}

	return rows, nil
}

// openingOf is the scope's balance BEFORE the window, read once: each account's last daily row before the first day,
// summed — one backward index probe per account (the-balance-series-is-a-running-sum).
func (s *Service) openingOf(ctx context.Context, teamID uint64, filters metricFilters) (float64, error) {
	var opening float64

	query := fmt.Sprintf(`
SELECT COALESCE(SUM(o.close_balance), 0)
FROM financial_accounts a
CROSS JOIN LATERAL (
    SELECT r.close_balance
    FROM financial_account_daily_reports r
    WHERE r.account_id = a.id AND r.day < %[1]s
    ORDER BY r.day DESC
    LIMIT 1
) o
WHERE %[2]s`, sqlDay(filters.start), accountScope(teamID, filters))

	err := s.db.WithContext(ctx).Raw(query).Scan(&opening).Error
	if err != nil {
		return 0, dbError(err)
	}

	return opening, nil
}

type dayMovement struct {
	Day string
	m.MetricColumns
}

// period is one row of a time group: its key (the period's first day) and its figures.
type period struct {
	key string
	figures
}

// series is every period of the window, oldest first — a quiet one included, since it still has a balance — in TWO
// statements whatever the span: the balance before the window, and the window's movement day by day. Each period's
// opening is the running balance at its first day IN the window (a period cut by the range starts at the range's
// first day), its closing that plus its change.
func (s *Service) series(ctx context.Context, teamID uint64, group analytic_basev1.GroupType, filters metricFilters) ([]period, error) {
	opening, err := s.openingOf(ctx, teamID, filters)
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf(`
SELECT to_char(r.day, 'YYYY-MM-DD') AS day, %[1]s
FROM financial_account_daily_reports r
WHERE %[2]s AND r.day BETWEEN %[3]s AND %[4]s
GROUP BY r.day`, movementSums("r"), reportScope(teamID, filters), sqlDay(filters.start),
		sqlDay(filters.end))

	days := []dayMovement{}

	err = s.db.WithContext(ctx).Raw(query).Scan(&days).Error
	if err != nil {
		return nil, dbError(err)
	}

	byDay := make(map[string]figures, len(days))
	for _, d := range days {
		byDay[d.Day] = d.MetricColumns
	}

	out := []period{}
	running := opening

	for at := periodStart(group, filters.start); !at.After(filters.end); at = periodEnd(group, at).AddDate(0, 0, 1) {
		from, to := at, periodEnd(group, at)
		if from.Before(filters.start) {
			from = filters.start
		}

		if to.After(filters.end) {
			to = filters.end
		}

		f := figures{}
		for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
			f = add(f, byDay[d.Format(dateLayout)])
		}

		f.OpenBalance = running
		f.CloseBalance = running + f.Change
		running = f.CloseBalance

		out = append(out, period{key: at.Format(dateLayout), figures: f})
	}

	return out, nil
}

// keyed is one id key — an account id, a provider's or a change type's enum number — and its figures.
type keyed struct {
	id uint64
	figures
}

// idKeys turns the per-account window into the keys an id group asks for, in key order.
func idKeys(group analytic_basev1.GroupType, rows []accountWindow) ([]keyed, error) {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT:
		out := make([]keyed, 0, len(rows))
		for _, r := range rows {
			out = append(out, keyed{id: r.AccountID, figures: r.MetricColumns})
		}

		return out, nil

	case analytic_basev1.GroupType_GROUP_TYPE_PROVIDER:
		// Read from the account NOW, never copied onto the daily row — an unknown account filled in moves its history.
		byProvider := map[uint64]figures{}

		for _, r := range rows {
			id := uint64(providerEnum[r.Provider])
			byProvider[id] = add(byProvider[id], r.MetricColumns)
		}

		out := make([]keyed, 0, len(byProvider))
		for id, f := range byProvider {
			out = append(out, keyed{id: id, figures: f})
		}

		slices.SortFunc(out, func(a, b keyed) int { return int(a.id) - int(b.id) })

		return out, nil

	case analytic_basev1.GroupType_GROUP_TYPE_CHANGE_TYPE:
		out := []keyed{}

		for _, t := range changeTypes {
			sum := 0.0
			moved := false

			for _, r := range rows {
				sum += column(r.MetricColumns, t)
				moved = moved || r.moved(t)
			}

			// A type that moved nothing in the window is no key of it.
			if !moved {
				continue
			}

			out = append(out, keyed{id: uint64(changeTypeEnum[t]), figures: onlyColumn(sum)})
		}

		return out, nil
	}

	return nil, invalidMetric("%s is not a group this service reads", group)
}

// summaryOf is the headline: every account in scope summed — the window's first-day balance, its movement, its
// last-day balance — equal to the rows by construction (the-headline-is-the-sum-of-its-rows).
func summaryOf(rows []accountWindow) figures {
	total := figures{}
	for _, r := range rows {
		total = add(total, r.MetricColumns)
	}

	return total
}
