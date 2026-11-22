package expense_v1

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// A TEAM'S DAY OF THE EXPENSE METRICS, RE-FOLDED FROM ITS RECORDS (a-wrong-day-is-refolded-from-the-log, its shape: one
// report, one scope, one date) — `san report refold --report expense-daily --team <id> --date <day>` is its one caller.
// The report is folded in the expense's own transaction, so it never loses an entry; what this re-fold is for is a row
// the report holds in an OLDER shape: expense 00009 gave the report its `type` and left every row written before it at
// type 0 — counted in its group and the total, in no type field (backlog #107). Re-folding the day writes each of its
// typed expenses into its type's row, exactly as the fold writes a new one.
//
// THE LOG is `expense_records`: the team's rows that count on that Jakarta day in Analytic — an expense whose own day it
// is (`occurred_at`), a correction or cancel MADE that day (`created_at`, in WIB) — each through metricEntryOf, the
// fold's own key and amount, so a re-fold equals the fold. Its rows replace the day's stored rows: one that already
// matches is left as it is, so a second run changes nothing. No expense row is written.
//
// ⚠ THE LOCK. The fold takes no advisory key: it inserts the expense row, then upserts the report as the LAST statement
// of its transaction, holding ROW EXCLUSIVE on the report until it commits. So the re-fold FIRST takes
// `expense_metric_daily_reports` in SHARE ROW EXCLUSIVE — it waits for every writer that already folded to commit, and
// every writer that has not yet folded waits for the re-fold — THEN reads the records: a writer that waited folds its own
// row onto the replaced ones after the re-fold commits. Reads are not blocked (ACCESS SHARE).

// ReportExpenseDaily is `expense_metric_daily_reports`, re-folded per team.
const ReportExpenseDaily = "expense-daily"

var (
	errRefoldNoTeam = errors.New(ReportExpenseDaily + " re-folds one team: a team id is required")
	// errMetricRefoldDryRun rolls the dry run's transaction back after everything was computed.
	errMetricRefoldDryRun = errors.New("dry run")
)

// MetricDayRefoldInput is one re-fold: the team and the Jakarta day.
type MetricDayRefoldInput struct {
	TeamID uint64
	Day    string
	// DryRun computes everything, writes it inside the transaction, and rolls it back.
	DryRun bool
}

// MetricDayRefoldRow is one of the day's report rows — a kind, flow and type for one shop and person: its amount as
// stored before and as the records say. Before is nil when the day had no such row; After nil when it is removed (an
// untyped row whose expenses now sit under their types).
type MetricDayRefoldRow struct {
	Kind   int32
	Flow   int16
	Type   int32
	ShopID uint64
	UserID uint64

	Before *float64
	After  *float64
}

// MetricDayRefoldResult is what the re-fold found and did.
type MetricDayRefoldResult struct {
	Rows []MetricDayRefoldRow
	// Counted is how many expense records the day's rows were rebuilt from.
	Counted int
	DryRun  bool
}

// Changed says whether any row moved.
func (r MetricDayRefoldResult) Changed() bool {
	for _, row := range r.Rows {
		if (row.Before == nil) != (row.After == nil) {
			return true
		}

		if row.Before != nil && !san_money.Equal(*row.Before, *row.After) {
			return true
		}
	}

	return false
}

// metricRowID is a report row's identity — the table's unique key without the day and team, which the re-fold fixes.
type metricRowID struct {
	Kind   int32
	Flow   int16
	Type   int32
	ShopID uint64
	UserID uint64
}

func rowIDOf(key metricRowKey) metricRowID {
	return metricRowID{Kind: key.Kind, Flow: key.Flow, Type: key.Type, ShopID: key.ShopID, UserID: key.UserID}
}

// refoldWant is one row as the records add up: its key (with the team's side) and its amount.
type refoldWant struct {
	key    metricRowKey
	amount float64
}

// MetricDayRefold rebuilds one team's day of the expense metrics from its `expense_records`.
func (s *Service) MetricDayRefold(ctx context.Context, in MetricDayRefoldInput) (MetricDayRefoldResult, error) {
	result := MetricDayRefoldResult{DryRun: in.DryRun}

	if in.TeamID == 0 {
		return result, errRefoldNoTeam
	}

	day, err := parseDate(in.Day)
	if err != nil {
		return result, fmt.Errorf("--date %q: %w", in.Day, err)
	}

	// Which side the team sits on — asked BEFORE the transaction, as the writers do: a call to another service never
	// holds a pooled connection across its round-trip.
	side, err := s.sides.SideOf(ctx, in.TeamID)
	if err != nil {
		return result, fmt.Errorf("ask the team's side: %w", err)
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result.Rows, result.Counted = nil, 0

		err := tx.Exec(`LOCK TABLE expense_metric_daily_reports IN SHARE ROW EXCLUSIVE MODE`).Error
		if err != nil {
			return fmt.Errorf("lock the report: %w", err)
		}

		want, counted, err := refoldRecords(tx, in.TeamID, day, side)
		if err != nil {
			return err
		}

		result.Counted = counted

		var stored []expense_service_models.ExpenseMetricDailyReport

		err = tx.
			Where("team_id = ?", in.TeamID).
			Where("day = CAST(? AS date)", in.Day).
			Order("id").
			Find(&stored).
			Error
		if err != nil {
			return fmt.Errorf("read the day's report rows: %w", err)
		}

		result.Rows, err = replaceDay(tx, stored, want)
		if err != nil {
			return err
		}

		if in.DryRun {
			return errMetricRefoldDryRun
		}

		return nil
	})
	if errors.Is(err, errMetricRefoldDryRun) {
		err = nil
	}

	return result, err
}

// refoldRecords is the day's rows as the records add up — every record of the team that counts on `day` in Analytic,
// through the fold's own metricEntryOf.
func refoldRecords(
	tx *gorm.DB,
	teamID uint64,
	day time.Time,
	side TeamSide,
) (map[metricRowID]refoldWant, int, error) {
	// The Jakarta day's instants — a correction counts on the day it is MADE (JakartaDay of its created_at).
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, wib)
	end := start.AddDate(0, 0, 1)

	// Two reads, each on the team's own index (team_id, occurred_at): the day's expenses, then the corrections made that
	// day. One OR of the two planned a scan of the whole table. Under the lock no fold commits between them.
	var expenses, corrections []expense_service_models.ExpenseRecord

	err := tx.
		Where("team_id = ?", teamID).
		Where("adjusts_expense_id = 0").
		Where("occurred_at = CAST(? AS date)", day.Format(dateLayout)).
		Order("id").
		Find(&expenses).
		Error
	if err != nil {
		return nil, 0, fmt.Errorf("read the day's expenses: %w", err)
	}

	err = tx.
		Where("team_id = ?", teamID).
		Where("adjusts_expense_id <> 0").
		Where("created_at >= ? AND created_at < ?", start, end).
		Order("id").
		Find(&corrections).
		Error
	if err != nil {
		return nil, 0, fmt.Errorf("read the day's corrections: %w", err)
	}

	records := append(expenses, corrections...)

	want := map[metricRowID]refoldWant{}
	counted := 0

	for i := range records {
		key, amount, ok := metricEntryOf(&records[i], side)
		if !ok || key.Day != day.Format(dateLayout) {
			continue
		}

		id := rowIDOf(key)
		w := want[id]
		w.key = key
		w.amount += amount
		want[id] = w
		counted++
	}

	return want, counted, nil
}

// replaceDay writes the day's rows as the records say: a stored row that already matches is left as it is, one that
// differs is rewritten, one the records no longer hold is deleted, a missing one is added. It returns every row the
// day had or now has, in a fixed order.
func replaceDay(
	tx *gorm.DB,
	stored []expense_service_models.ExpenseMetricDailyReport,
	want map[metricRowID]refoldWant,
) ([]MetricDayRefoldRow, error) {
	rows := []MetricDayRefoldRow{}
	seen := map[metricRowID]bool{}

	for _, row := range stored {
		id := metricRowID{Kind: row.Kind, Flow: row.Flow, Type: row.Type, ShopID: row.ShopID, UserID: row.UserID}
		seen[id] = true

		before := row.Amount
		out := MetricDayRefoldRow{Kind: id.Kind, Flow: id.Flow, Type: id.Type, ShopID: id.ShopID, UserID: id.UserID, Before: &before}

		w, held := want[id]
		if !held {
			err := tx.Delete(&expense_service_models.ExpenseMetricDailyReport{}, row.ID).Error
			if err != nil {
				return nil, fmt.Errorf("remove report row %d: %w", row.ID, err)
			}

			rows = append(rows, out)

			continue
		}

		after := w.amount
		out.After = &after

		sameSide := row.SellerID == w.key.SellerID && row.WarehouseID == w.key.WarehouseID
		if !san_money.Equal(before, after) || !sameSide {
			err := tx.
				Model(&expense_service_models.ExpenseMetricDailyReport{}).
				Where("id = ?", row.ID).
				Updates(map[string]any{
					"amount":       after,
					"seller_id":    w.key.SellerID,
					"warehouse_id": w.key.WarehouseID,
					"last_updated": gorm.Expr("NOW()"),
				}).
				Error
			if err != nil {
				return nil, fmt.Errorf("rewrite report row %d: %w", row.ID, err)
			}
		}

		rows = append(rows, out)
	}

	for id, w := range want {
		if seen[id] {
			continue
		}

		err := tx.Exec(`
INSERT INTO expense_metric_daily_reports
    (day, team_id, seller_id, warehouse_id, kind, flow, type, shop_id, user_id, amount, last_updated)
VALUES (CAST(? AS date), ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS double precision), NOW())`,
			w.key.Day, w.key.TeamID, w.key.SellerID, w.key.WarehouseID, w.key.Kind, w.key.Flow, w.key.Type, w.key.ShopID,
			w.key.UserID, w.amount,
		).Error
		if err != nil {
			return nil, fmt.Errorf("add report row: %w", err)
		}

		after := w.amount
		rows = append(rows, MetricDayRefoldRow{
			Kind: id.Kind, Flow: id.Flow, Type: id.Type, ShopID: id.ShopID, UserID: id.UserID, After: &after,
		})
	}

	slices.SortFunc(rows, func(a, b MetricDayRefoldRow) int {
		return cmp.Or(
			cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.Flow, b.Flow), cmp.Compare(a.Type, b.Type),
			cmp.Compare(a.ShopID, b.ShopID), cmp.Compare(a.UserID, b.UserID),
		)
	})

	return rows, nil
}
