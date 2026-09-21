package settlement_v1

import (
	"fmt"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// groupSpecOf names the table and the grouping column for a group type. TEAM groups the SHOP table by
// team — a team's position is the sum of its shops'.
func groupSpecOf(groupType settlementv1.AnalyticGroupType) (reportGrain, string, error) {
	switch groupType {
	case settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_TEAM:
		return shopDaily, "team_id", nil
	case settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_SHOP:
		return shopDaily, "shop_id", nil
	case settlementv1.AnalyticGroupType_ANALYTIC_GROUP_TYPE_USER:
		return userDaily, "user_id", nil
	default:
		return reportGrain{}, "", errBadGroup
	}
}

// groupScope is the team restriction a grouped read runs under — none from the root team.
func groupScope(teamID uint64, args map[string]any) string {
	if isRootScope(teamID) {
		return "TRUE"
	}

	args["team"] = teamID

	return "r.team_id = @team"
}

// metricSortColumn maps each sort to its SettlementMetric column.
var metricSortColumn = map[settlementv1.AnalyticMetricSort]string{
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_INITIAL_TOTAL:          "initial_total",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_INITIAL_TOTAL_CANCEL:   "initial_total_cancel",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_OTHER:                  "other",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_FUND:                   "fund",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_EXTERNAL_ADS_FEE:       "external_ads_fee",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_AFFILIATE_FEE:          "affiliate_fee",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_MARKETPLACE_ADJUSTMENT: "marketplace_adjustment",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_SYSTEM_ADJUSTMENT:      "system_adjustment",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_CHANGE:                 "change",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_OPEN_BALANCE:           "open_balance",
	settlementv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_CLOSE_BALANCE:          "close_balance",
}

// groupMetricsCTE is ONE definition of a group's metric over a window, read by both the search (to rank)
// and the metric RPC (to fill) — so the ranking and the numbers beside it cannot disagree.
//
//   - a group exists once it holds ANY position at or before the window's end, so a group quiet in the
//     window still ranks by the shortfall it carries in;
//   - close = Σ over the group's positions of each position's latest close at or before the end;
//   - movement = Σ over the window; open = close − movement.
func groupMetricsCTE(grain reportGrain, key, scope string) string {
	return fmt.Sprintf(`
WITH scoped AS (
    SELECT r.*, r.%[2]s AS gid
    FROM %[1]s r
    WHERE %[3]s AND r.day <= CAST(@end AS date)
),
latest AS (
    SELECT positions.gid, SUM(positions.close_balance) AS close_balance
    FROM (
        SELECT DISTINCT ON (%[4]s) gid, close_balance
        FROM scoped
        ORDER BY %[4]s, day DESC
    ) positions
    GROUP BY positions.gid
),
moves AS (
    SELECT gid, %[5]s
    FROM scoped
    WHERE day >= CAST(@start AS date)
    GROUP BY gid
),
metrics AS (
    SELECT l.gid, %[6]s,
           l.close_balance - COALESCE(m.change, 0) AS open_balance,
           l.close_balance
    FROM latest l
    LEFT JOIN moves m ON m.gid = l.gid
)`, grain.table, key, scope, columnsOf("", grain.position), movementSums(""), movementsFrom("m"))
}

type groupMetricRow struct {
	Gid uint64
	settlement_service_models.SettlementMetricColumns
}
