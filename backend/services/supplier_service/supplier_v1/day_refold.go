package supplier_v1

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// A WRONG DAY IS RE-FOLDED FROM THE LOG (docs/business/settlement/context_decision.md#a-wrong-day-is-refolded-from-the-log)
// — for a supplier's two event-fed reports: the repair for a day that is short while the log is right, which is what a
// lost event leaves (a-report-is-fed-by-events-only-for-now). One report, one scope — a SUPPLIER — one Jakarta day: it
// re-reads that day's log for the supplier, recomputes the day's rows and replaces them. It writes nothing to the log.
// `san report refold --report supplier-restock-daily|supplier-sale-daily` is its one caller.
//
//	supplier-restock-daily   supplier_product_daily_reports   the restocks accepted that day (inventory's)
//	supplier-sale-daily      supplier_sale_daily_reports      the orders placed and cancelled that day (selling's), their
//	                                                          takes (inventory's)
//
// THE LOG IS OTHER SERVICES'. Supplier owns no source rows — only its claims. The re-fold therefore counts every event
// its CLAIMS hold for the day (exactly what the fold folded: the claim keeps the event, or the order's parts), and asks
// the log — through RefoldSource, answered in-process by the composition root — only for the events nobody claimed:
// a lost one (older than refoldInFlight) is claimed and counted, so its late redelivery folds nothing; a young one is in
// flight, left to the fold. No row carries a balance, so no later day moves.
//
// ⚠ THE LOCK. Neither fold takes an advisory lock: each claims, then upserts — and an upsert holds ROW EXCLUSIVE on the
// report until it commits. So the re-fold claims first (the folds' order), then takes the report in SHARE ROW
// EXCLUSIVE: it waits for every fold that already wrote, and every fold that has not yet written waits for it. Reads are
// not blocked. Under the lock the claims are re-read, so a fold still waiting — its claim invisible — is not counted and
// adds its event after.

// The reports the supplier re-fold rebuilds.
const (
	// ReportRestockDaily is `supplier_product_daily_reports` — Restock, Lost on the way, Broken — re-folded per supplier.
	ReportRestockDaily = "supplier-restock-daily"
	// ReportSaleDaily is `supplier_sale_daily_reports` — Penjualan — re-folded per supplier.
	ReportSaleDaily = "supplier-sale-daily"
)

// refoldInFlight is how young an unclaimed event may be and still count as on its way — settlement's hour: Pub/Sub's
// backoff tops out at ten minutes, and a publish waits a minute at most.
const refoldInFlight = time.Hour

// RefoldSource is what the re-fold reads of the other services' logs — answered IN-PROCESS by the composition root, from
// their own tables, so this service holds no copy of them.
type RefoldSource interface {
	// RestockAcceptsOn is the RestockAccepted event of every restock accepted on the Jakarta day, as inventory builds
	// it for the accept itself (one builder, so the two cannot disagree).
	RestockAcceptsOn(ctx context.Context, day string) ([]*eventsv1.Event, error)
	// OrderSalesOn is the OrderPlaced of every order placed on the Jakarta day, and the OrderCancelled of every order
	// cancelled on it — the ids and moments the order announced, and what the sales fold reads: the lines (product,
	// quantity, total), the platform total and the take.
	OrderSalesOn(ctx context.Context, day string) ([]*eventsv1.Event, error)
}

var (
	errRefoldUnknownReport = errors.New("the supplier re-fold rebuilds " + ReportRestockDaily + " or " + ReportSaleDaily)
	errRefoldNoSupplier    = errors.New("a supplier re-fold names one supplier: a supplier id is required")
	errRefoldNoSource      = errors.New("no log to re-read: the re-fold needs the composition root's source")
	// ErrRefoldLocked is the restock re-fold's answer while a replay holds the fold's lock — exported for `san`.
	ErrRefoldLocked = errors.New("a replay holds the fold's lock (process_event_lock) — run the re-fold after it")
	// errRefoldDryRun rolls the dry run's transaction back after everything was computed.
	errRefoldDryRun = errors.New("dry run")
)

// DayRefoldInput is one re-fold: the report, the supplier, the Jakarta day.
type DayRefoldInput struct {
	Report     string
	SupplierID uint64
	Day        string
	// DryRun computes everything, writes it inside the transaction, and rolls it back.
	DryRun bool
}

// DayRefoldRow is one of the day's rows — the supplier's product for one team: its figures as stored before and as the
// log says, in DayRefoldResult.Columns' order. Before is nil when the day had no such row; After nil when it is removed.
type DayRefoldRow struct {
	ProductID uint64
	TeamID    uint64
	Before    []float64
	After     []float64
}

// ShortScope is a supplier's day another report scope's claim left short: the lost event is claimed now, so no
// redelivery will add it there — its own re-fold will.
type ShortScope struct {
	SupplierID uint64
	Day        string
}

// DayRefoldResult is what the re-fold found and did.
type DayRefoldResult struct {
	// Columns names the figures of every row, in order.
	Columns []string
	Rows    []DayRefoldRow

	// Counted is how many events the day's rows were rebuilt from; Claimed how many of them nobody had claimed (lost);
	// InFlight how many unclaimed events of the day were left to the fold.
	Counted  int
	Claimed  int
	InFlight int

	// Short is every other (supplier, day) the claims made here leave short until its own re-fold — Penjualan only: one
	// order feeds several suppliers, and its cancel another day.
	Short []ShortScope

	DryRun bool
}

// Changed says whether any row moved.
func (r DayRefoldResult) Changed() bool {
	for _, row := range r.Rows {
		if !sameRefoldFigures(row.Before, row.After) {
			return true
		}
	}

	return false
}

// DayRefold re-folds one supplier's day of one of its reports from the log.
func (s *Service) DayRefold(ctx context.Context, in DayRefoldInput, source RefoldSource) (DayRefoldResult, error) {
	result := DayRefoldResult{DryRun: in.DryRun}

	if in.Report != ReportRestockDaily && in.Report != ReportSaleDaily {
		return result, errRefoldUnknownReport
	}

	if in.SupplierID == 0 {
		return result, errRefoldNoSupplier
	}

	if source == nil {
		return result, errRefoldNoSource
	}

	_, err := parseDate(in.Day)
	if err != nil {
		return result, err
	}

	var run func(tx *gorm.DB) (DayRefoldResult, error)

	if in.Report == ReportRestockDaily {
		// The log is read before the transaction, as the fold receives its event before it opens one: an accepted
		// restock never changes, so nothing here holds a lock while inventory is asked.
		accepts, err := source.RestockAcceptsOn(ctx, in.Day)
		if err != nil {
			return result, fmt.Errorf("supplier re-fold: the day's accepts: %w", err)
		}

		run = func(tx *gorm.DB) (DayRefoldResult, error) {
			return refoldRestockDay(tx, in, accepts)
		}
	} else {
		sales, err := s.saleLog(ctx, in.Day, source)
		if err != nil {
			return result, err
		}

		run = func(tx *gorm.DB) (DayRefoldResult, error) {
			return refoldSaleDay(tx, in, sales)
		}
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error

		result, err = run(tx)
		if err != nil {
			return err
		}

		if in.DryRun {
			return errRefoldDryRun
		}

		return nil
	})
	if errors.Is(err, errRefoldDryRun) {
		return result, nil
	}

	if err != nil {
		return DayRefoldResult{DryRun: in.DryRun}, err
	}

	return result, nil
}

// refoldKey is one row of a supplier's day: the product and the team.
type refoldKey struct {
	ProductID uint64
	TeamID    uint64
}

func refoldRestockDay(tx *gorm.DB, in DayRefoldInput, accepts []*eventsv1.Event) (DayRefoldResult, error) {
	result := DayRefoldResult{DryRun: in.DryRun, Columns: restockColumns}

	// 1 · THE MAINTENANCE LOCK, FOR SHARE — as the fold reads it. A replay deleting a range never interleaves with this.
	locked, err := readEventLock(tx.Clauses(clause.Locking{Strength: "SHARE"}))
	if err != nil {
		return result, err
	}

	if locked {
		return result, ErrRefoldLocked
	}

	// 2 · CLAIM THE LOST ACCEPTS — the supplier's, of the day, never claimed and over an hour old — before the report's
	// lock, as the fold claims before it writes. A redelivery folding one right now holds its claim uncommitted; this
	// insert waits for it, and DO NOTHING keeps whichever came first.
	held, err := dayClaims(tx, in.Day)
	if err != nil {
		return result, err
	}

	for _, event := range accepts {
		accepted := event.GetRestockAccepted()
		if accepted == nil || accepted.GetSupplierId() != in.SupplierID || accepted.GetAcceptedOn() != in.Day || held[event.GetEventId()] {
			continue
		}

		if time.Since(event.GetOccurredAt().AsTime()) < refoldInFlight {
			continue
		}

		claimed, err := claimEvent(tx, event, in.Day)
		if err != nil {
			return result, err
		}

		if claimed {
			result.Claimed++
		}
	}

	// 3 · THE FOLD's OWN LOCK — every upsert's ROW EXCLUSIVE on the report waits on this, and this on every upsert.
	err = tx.Exec(`LOCK TABLE supplier_product_daily_reports IN SHARE ROW EXCLUSIVE MODE`).Error
	if err != nil {
		return result, fmt.Errorf("supplier re-fold: lock the report: %w", err)
	}

	// 4 · UNDER THE LOCK, what counts is every claim of the day that names the supplier — the event as it was folded.
	held, err = dayClaims(tx, in.Day)
	if err != nil {
		return result, err
	}

	claims := []struct {
		ID  string
		Raw []byte
	}{}

	err = tx.
		Raw(`SELECT id, raw FROM supplier_event_logs WHERE day = CAST(? AS date) ORDER BY id`, in.Day).
		Scan(&claims).
		Error
	if err != nil {
		return result, fmt.Errorf("supplier re-fold: the day's claims: %w", err)
	}

	after := map[refoldKey][]float64{}

	for _, claim := range claims {
		event, err := san_event.Unmarshal(claim.Raw)
		if err != nil {
			return result, fmt.Errorf("supplier re-fold: claim %s does not read: %w", claim.ID, err)
		}

		accepted := event.GetRestockAccepted()
		if accepted == nil || accepted.GetSupplierId() != in.SupplierID {
			continue
		}

		result.Counted++

		// The fold's own arithmetic, line by line (foldLines): a line that counted nothing writes nothing.
		for _, line := range accepted.GetLines() {
			good, lost, broken := line.GetAcceptedCount(), line.GetMissingCount(), line.GetBrokenCount()
			if good == 0 && lost == 0 && broken == 0 {
				continue
			}

			value := lineValue(line)
			key := refoldKey{ProductID: line.GetProductId(), TeamID: accepted.GetTeamId()}

			row := after[key]
			if row == nil {
				row = make([]float64, len(restockColumns))
				after[key] = row
			}

			row[0] += float64(good)
			row[1] += value(good)
			row[2] += float64(lost)
			row[3] += value(lost)
			row[4] += float64(broken)
			row[5] += value(broken)
		}
	}

	for _, event := range accepts {
		accepted := event.GetRestockAccepted()
		if accepted != nil && accepted.GetSupplierId() == in.SupplierID && accepted.GetAcceptedOn() == in.Day && !held[event.GetEventId()] {
			result.InFlight++
		}
	}

	// 5 · THE STORED ROWS, then replace what differs and remove what the log does not hold.
	stored := []struct {
		ProductID               uint64
		TeamID                  uint64
		RestockCount            int64
		RestockValuation        float64
		ShippingLostCount       int64
		ShippingLostValuation   float64
		ShippingBrokenCount     int64
		ShippingBrokenValuation float64
	}{}

	err = tx.
		Raw(`SELECT product_id, team_id, restock_count, restock_valuation, shipping_lost_count, shipping_lost_valuation,
       shipping_broken_count, shipping_broken_valuation
FROM supplier_product_daily_reports WHERE day = CAST(? AS date) AND supplier_id = ?`, in.Day, in.SupplierID).
		Scan(&stored).
		Error
	if err != nil {
		return result, fmt.Errorf("supplier re-fold: the day's rows: %w", err)
	}

	before := map[refoldKey][]float64{}
	for _, r := range stored {
		before[refoldKey{ProductID: r.ProductID, TeamID: r.TeamID}] = []float64{
			float64(r.RestockCount), r.RestockValuation, float64(r.ShippingLostCount), r.ShippingLostValuation,
			float64(r.ShippingBrokenCount), r.ShippingBrokenValuation,
		}
	}

	result.Rows, err = replaceDayRows(tx, "supplier_product_daily_reports", restockColumns, in, before, after)
	if err != nil {
		return result, err
	}

	return result, nil
}

// dayClaims is every event id claimed for the day.
func dayClaims(tx *gorm.DB, day string) (map[string]bool, error) {
	ids := []string{}

	err := tx.
		Raw(`SELECT id FROM supplier_event_logs WHERE day = CAST(? AS date)`, day).
		Scan(&ids).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier re-fold: the day's claims: %w", err)
	}

	held := make(map[string]bool, len(ids))
	for _, id := range ids {
		held[id] = true
	}

	return held, nil
}

// claimEvent writes the fold's claim for an event that never arrived — the very event the accept sends, so its
// redelivery collides here. False when a fold or another re-fold claimed it first.
func claimEvent(tx *gorm.DB, event *eventsv1.Event, day string) (bool, error) {
	raw, err := san_event.Marshal(event)
	if err != nil {
		return false, err
	}

	claim := tx.Exec(
		`INSERT INTO supplier_event_logs (id, raw, day) VALUES (?, ?, CAST(? AS date)) ON CONFLICT (id) DO NOTHING`,
		event.GetEventId(), raw, day,
	)
	if claim.Error != nil {
		return false, fmt.Errorf("supplier re-fold: claim %s: %w", event.GetEventId(), claim.Error)
	}

	return claim.RowsAffected == 1, nil
}

// replaceDayRows REPLACES each of the supplier's rows of the day whose figures differ from the log's, removes the ones
// the log does not hold, and leaves the matching ones as they are — `last_updated` included, so a second run writes
// nothing. Counts are the even columns, valuations the odd ones; both are compared with san_money's tolerance.
func replaceDayRows(
	tx *gorm.DB,
	table string,
	columns []string,
	in DayRefoldInput,
	before, after map[refoldKey][]float64,
) ([]DayRefoldRow, error) {
	keys := make([]refoldKey, 0, len(before)+len(after))
	for key := range before {
		keys = append(keys, key)
	}

	for key := range after {
		if before[key] == nil {
			keys = append(keys, key)
		}
	}

	slices.SortFunc(keys, func(a, b refoldKey) int {
		return cmp.Or(cmp.Compare(a.ProductID, b.ProductID), cmp.Compare(a.TeamID, b.TeamID))
	})

	rows := make([]DayRefoldRow, 0, len(keys))

	for _, key := range keys {
		row := DayRefoldRow{ProductID: key.ProductID, TeamID: key.TeamID, Before: before[key], After: after[key]}
		rows = append(rows, row)

		if sameRefoldFigures(row.Before, row.After) {
			continue
		}

		if row.After == nil {
			err := tx.
				Exec(fmt.Sprintf(`DELETE FROM %s WHERE day = CAST(? AS date) AND supplier_id = ? AND product_id = ? AND team_id = ?`, table),
					in.Day, in.SupplierID, key.ProductID, key.TeamID).
				Error
			if err != nil {
				return rows, fmt.Errorf("supplier re-fold: remove a row: %w", err)
			}

			continue
		}

		values := map[string]any{"day": in.Day, "supplier": in.SupplierID, "product": key.ProductID, "team": key.TeamID}
		params := make([]string, len(columns))
		sets := make([]string, len(columns))

		for i, column := range columns {
			// A count column is a whole number of units; the float only carried it through the comparison.
			if i%2 == 0 {
				values[column] = int64(row.After[i])
			} else {
				values[column] = row.After[i]
			}

			params[i] = "@" + column
			sets[i] = column + " = EXCLUDED." + column
		}

		err := tx.
			Exec(fmt.Sprintf(`
INSERT INTO %[1]s (day, supplier_id, product_id, team_id, %[2]s, last_updated)
VALUES (CAST(@day AS date), @supplier, @product, @team, %[3]s, NOW())
ON CONFLICT (day, supplier_id, product_id, team_id) DO UPDATE
SET %[4]s,
    last_updated = NOW()`, table, strings.Join(columns, ", "), strings.Join(params, ", "), strings.Join(sets, ",\n    ")), values).
			Error
		if err != nil {
			return rows, fmt.Errorf("supplier re-fold: write a row: %w", err)
		}
	}

	return rows, nil
}

// sameRefoldFigures compares two rows' figures with san_money's tolerance, never == on a double
// (every-ledger-moves-to-double-rounded-when-frozen); a missing row matches only a missing row.
func sameRefoldFigures(a, b []float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	for i := range a {
		if !san_money.Equal(a[i], b[i]) {
			return false
		}
	}

	return true
}
