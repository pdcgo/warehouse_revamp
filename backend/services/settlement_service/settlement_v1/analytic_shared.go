package settlement_v1

import (
	"fmt"
	"strings"
	"time"
)

// jakarta is the system's calendar (the-system-runs-on-jakarta-time). Fixed +7: WIB has no daylight
// saving, and a fixed zone needs no tzdata on the host.
var jakarta = time.FixedZone("WIB", 7*60*60)

// trackedColumns is analytic_context.md §Field that tracked — the movement columns, in SettlementMetric
// order. ⚠ The settlement_type TEXT is the column name, so the mapping from a row to its column is an
// identity checked against this list, never a second table that could drift.
var trackedColumns = []string{
	typeInitialTotal,
	typeInitialTotalCancel,
	typeOther,
	typeFund,
	typeExternalAdsFee,
	typeAffiliateFee,
	typeMarketplaceAdjust,
	typeSystemAdjustment,
	// The five of 2026-09-24, widened WITH SettlementPost, never after: the fold refuses a type it has no
	// column for, and nothing compares the report with the log (#the-reconcile-check-is-not-built).
	typeWithdrawal,
	typeShipmentAdjustment,
	typeLogisticReimbursement,
	typePlatformReimbursement,
	typeMarketplaceProgram,
}

// columnOfType is the report column a settlement_type folds into.
func columnOfType(typeText string) (string, bool) {
	for _, column := range trackedColumns {
		if column == typeText {
			return column, true
		}
	}

	return "", false
}

// reportGrain is one daily report table and its key. A scope's position is the running sum of its rows' change
// (metric_shared.go's idBase and timeBase); the fold and the day re-fold write a row per (key, team, day).
type reportGrain struct {
	table string
	key   string
}

var (
	shopDaily = reportGrain{
		table: "shop_settlement_daily_reports",
		key:   "shop_id",
	}
	userDaily = reportGrain{
		table: "user_settlement_daily_reports",
		key:   "user_id",
	}
)

// movementSums renders "COALESCE(SUM(r.initial_total), 0) AS initial_total, …, … AS change".
func movementSums(alias string) string {
	prefix := ""
	if alias != "" {
		prefix = alias + "."
	}

	parts := make([]string, 0, len(trackedColumns)+1)

	for _, column := range append(append([]string{}, trackedColumns...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s%s), 0) AS %s", prefix, column, column))
	}

	return strings.Join(parts, ", ")
}

// movementSumsWhere is movementSums with every sum FILTERed to `where` — the window's movement read in the same pass
// as a position that runs over every earlier row.
func movementSumsWhere(alias, where string) string {
	parts := make([]string, 0, len(trackedColumns)+1)

	for _, column := range append(append([]string{}, trackedColumns...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s.%s) FILTER (WHERE %s), 0) AS %s", alias, column, where, column))
	}

	return strings.Join(parts, ", ")
}

// movementsFrom renders "COALESCE(m.initial_total, 0) AS initial_total, …" — the columns of a joined
// movement row, zero when the join found nothing.
func movementsFrom(alias string) string {
	parts := make([]string, 0, len(trackedColumns)+1)

	for _, column := range append(append([]string{}, trackedColumns...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(%s.%s, 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}
