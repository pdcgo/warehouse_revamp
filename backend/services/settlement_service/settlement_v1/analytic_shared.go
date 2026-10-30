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

// reportGrain is one daily report table: its key, and the columns that identify ONE position — a scope's
// latest close_balance is read per position, then summed (metric_shared.go's idBase and timeBase).
type reportGrain struct {
	table    string
	key      string
	position []string
}

var (
	shopDaily = reportGrain{
		table:    "shop_settlement_daily_reports",
		key:      "shop_id",
		position: []string{"shop_id", "team_id"},
	}
	userDaily = reportGrain{
		table:    "user_settlement_daily_reports",
		key:      "user_id",
		position: []string{"user_id", "team_id"},
	}
)

// columnsOf renders column names under an alias: "r.shop_id, r.team_id".
func columnsOf(alias string, columns []string) string {
	rendered := make([]string, 0, len(columns))

	for _, column := range columns {
		if alias == "" {
			rendered = append(rendered, column)

			continue
		}

		rendered = append(rendered, alias+"."+column)
	}

	return strings.Join(rendered, ", ")
}

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

// movementsFrom renders "COALESCE(m.initial_total, 0) AS initial_total, …" — the columns of a joined
// movement row, zero when the join found nothing.
func movementsFrom(alias string) string {
	parts := make([]string, 0, len(trackedColumns)+1)

	for _, column := range append(append([]string{}, trackedColumns...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(%s.%s, 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}
