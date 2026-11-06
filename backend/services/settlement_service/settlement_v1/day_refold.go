package settlement_v1

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// A WRONG DAY IS RE-FOLDED FROM THE LOG (docs/business/settlement/context_decision.md#a-wrong-day-is-refolded-from-the-log)
// — the operator's repair for a report day that is wrong while the log is right: one report, one scope, one date. It
// re-reads that day's log rows, recomputes that day's report row and replaces it. It adds no log row. `san report
// refold` is its one caller.
//
// TWO REPORTS (the-person-report-refolds-too): the shop report, keyed by a shop, and the person report, keyed by the
// person the fold counts a row for — the order's creator, an imported shop row's primary CS, else the actor.
//
// THE LATER DAYS (a-refold-shifts-the-later-days): the corrected day's close moves by some difference, and every later
// day of the scope shifts its open and close by exactly that — the fold's own later-day shift for a late event
// (shiftLaterDays). Later days' movement is never touched; the scope's state row is re-derived after the shift.
//
// ⚠ WHAT IT COUNTS, so that it never races the fold into a double count:
//
//   - every row of the day whose event is CLAIMED (settlement_event_logs) — by the fold, which put it in both reports,
//     or by an earlier re-fold of the other report, which did not; rebuilt from the log, both cases are the same;
//   - every row never claimed and older than refoldInFlight — its event was lost, which is what the repair is for. The
//     re-fold CLAIMS it, so a late redelivery of that event is a no-op rather than a second count. The claim is one per
//     event and both reports share it, so the OTHER report is now short by that row until its own re-fold counts it
//     (the result names the scopes: DayRefoldResult.Short);
//   - NOT a row never claimed and younger than that: its event is in flight, and the fold will add it after the re-fold
//     commits. It is reported as in flight.
//
// ⚠ LOCKS, the fold's order: the fold's maintenance lock FOR SHARE (a running replay refuses it, as it refuses a fold),
// the lost rows' claims, then the report's advisory lock per team in team order — `settlement-shop` for the shop
// report, `settlement-user` for the person report. A fold takes its claim before its locks, and the re-fold claims
// before it locks too, so neither ever waits on a claim while holding an advisory lock
// (audits/services/settlement_service/concurrency/lock-order.md).

// The reports the re-fold rebuilds.
const (
	// ReportShopDaily is `shop_settlement_daily_reports`, re-folded per shop.
	ReportShopDaily = "settlement-shop-daily"
	// ReportUserDaily is `user_settlement_daily_reports`, re-folded per person.
	ReportUserDaily = "settlement-user-daily"
)

// refoldInFlight is how young an unclaimed row may be and still count as an event on its way — Pub/Sub's backoff
// tops out at ten minutes, and a SettlementPost waits a minute at most for its publish.
const refoldInFlight = "1 hour"

var (
	errRefoldUnknownReport = errors.New("the re-fold rebuilds " + ReportShopDaily + " (by shop) or " + ReportUserDaily + " (by user)")
	errRefoldNoShop        = errors.New(ReportShopDaily + " re-folds one shop: a shop id is required")
	errRefoldNoUser        = errors.New(ReportUserDaily + " re-folds one person: a user id is required")
	errRefoldTwoScopes     = errors.New("a re-fold names one scope: a shop for " + ReportShopDaily + ", a user for " + ReportUserDaily)
	// ErrRefoldLocked is the re-fold's answer while a replay holds the fold's lock — exported for `san` to say so.
	ErrRefoldLocked = errors.New("a replay holds the fold's lock (process_event_lock) — run the re-fold after it")
	// errRefoldDryRun rolls the dry run's transaction back after everything was computed.
	errRefoldDryRun = errors.New("dry run")
)

// DayRefoldInput is one re-fold: the report, its scope, the Jakarta day.
type DayRefoldInput struct {
	Report string

	// ShopID is the shop report's scope; 0 on the person report.
	ShopID uint64
	// UserID is the person report's scope; nil on the shop report. A pointer because 0 is a real key there — the person
	// report's row for "not recorded" (00005), which a lost event can leave short like any other.
	UserID *uint64

	Day string
	// DryRun computes everything, writes it inside the transaction, and rolls it back.
	DryRun bool
}

// DayRefoldTeam is the day's row of one (scope, team): as stored before, and as the log says.
type DayRefoldTeam struct {
	TeamID uint64

	// Before is the stored row; nil when the day had none.
	Before *settlement_service_models.SettlementMetricColumns
	// After is the row rewritten from the log; nil when the log holds nothing countable that day, so the row is removed.
	After *settlement_service_models.SettlementMetricColumns

	// CarryDelta is how far the day's close moved — the new close minus the one the later days carried from (the stored
	// close, or the open when the day had no row) — and LaterDays how many later rows were shifted by it.
	CarryDelta float64
	LaterDays  int64

	// NextDay is the scope's next later row, and NextGap how far its open, after the shift, sits from this day's close:
	// 0 on a carry that chains. Non-zero only where that row's carry was already off before this re-fold, which a shift
	// keeps — re-folding NextDay closes it.
	NextDay string
	NextGap float64
}

// DayRefoldResult is what the re-fold found and did.
type DayRefoldResult struct {
	Teams []DayRefoldTeam

	// Counted is how many log rows the day's rows were rebuilt from; Claimed how many of them nobody had claimed (their
	// events were lost); InFlight how many were left to the fold.
	Counted  int
	Claimed  int
	InFlight int

	// OtherReport is the report the same log rows also feed, and Short its scopes the rows claimed here count for — the
	// people of a shop's day, the shops of a person's day. Each is short by those rows until its own re-fold runs:
	// a redelivery no longer folds them.
	OtherReport string
	Short       []uint64

	DryRun bool
}

// Changed says whether any team's row moved.
func (r DayRefoldResult) Changed() bool {
	for _, team := range r.Teams {
		if !sameColumns(team.Before, team.After) {
			return true
		}
	}

	return false
}

// refoldLog is one of the day's log rows, and whether its event is claimed.
type refoldLog struct {
	settlement_service_models.SettlementLog

	Claimed         bool
	Old             bool
	CreatedByUserID uint64
	// OtherKey is the row's scope in the other report — its person on a shop re-fold, its shop on a person re-fold.
	OtherKey uint64
}

// attributedUser is the person the fold counts a log row for, in SQL over `l` (settlement_logs) and `o` (the order's
// account): the ORDER's creator on an order row, the person written on a shop row (an imported row's primary CS), else
// its actor — fold()'s switch, case for case. The creator is stamped once, by the post that opens the account, so the
// account says what the event said.
const attributedUser = `(CASE WHEN COALESCE(l.order_id, 0) <> 0 THEN COALESCE(o.created_by_user_id, 0)
             WHEN l.user_id <> 0 THEN l.user_id
             ELSE l.actor_id END)`

// refoldReport is one report the re-fold rebuilds: its daily table and state row, the fold's advisory namespace for it,
// and which log rows belong to a scope.
type refoldReport struct {
	grain        reportGrain
	stateTable   string
	keepsLastDay bool
	lock         string

	// scope selects the scope's log rows (`@key`); otherKey is a row's key in the other report.
	scope    string
	other    string
	otherKey string
}

var (
	refoldShop = refoldReport{
		grain:      shopDaily,
		stateTable: "shop_settlement_reports",
		lock:       "settlement-shop:",
		scope:      "l.shop_id = @key",
		other:      ReportUserDaily,
		otherKey:   attributedUser,
	}
	refoldUser = refoldReport{
		grain:        userDaily,
		stateTable:   "user_settlement_reports",
		keepsLastDay: true,
		lock:         "settlement-user:",
		scope:        attributedUser + " = @key",
		other:        ReportShopDaily,
		otherKey:     "l.shop_id",
	}
)

// refoldScope reads which report and which key the input names, refusing two scopes or none.
func refoldScope(in DayRefoldInput) (refoldReport, uint64, error) {
	switch in.Report {
	case ReportShopDaily:
		if in.UserID != nil {
			return refoldReport{}, 0, errRefoldTwoScopes
		}

		if in.ShopID == 0 {
			return refoldReport{}, 0, errRefoldNoShop
		}

		return refoldShop, in.ShopID, nil
	case ReportUserDaily:
		if in.ShopID != 0 {
			return refoldReport{}, 0, errRefoldTwoScopes
		}

		if in.UserID == nil {
			return refoldReport{}, 0, errRefoldNoUser
		}

		return refoldUser, *in.UserID, nil
	}

	return refoldReport{}, 0, errRefoldUnknownReport
}

// DayRefold re-folds one scope's day of a settlement report from `settlement_logs`.
func (s *Service) DayRefold(ctx context.Context, in DayRefoldInput) (DayRefoldResult, error) {
	result := DayRefoldResult{DryRun: in.DryRun}

	report, key, err := refoldScope(in)
	if err != nil {
		return result, err
	}

	_, err = parseDate(in.Day)
	if err != nil {
		return result, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error

		result, err = refoldDay(tx, report, key, in)
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

func refoldDay(tx *gorm.DB, report refoldReport, key uint64, in DayRefoldInput) (DayRefoldResult, error) {
	result := DayRefoldResult{DryRun: in.DryRun, OtherReport: report.other}

	// 1 · THE MAINTENANCE LOCK, FOR SHARE — as the fold reads it. A replay deleting a range never interleaves with this.
	locked, err := readEventLock(tx.Clauses(clause.Locking{Strength: "SHARE"}))
	if err != nil {
		return result, err
	}

	if locked {
		return result, ErrRefoldLocked
	}

	// 2 · THE DAY's LOG ROWS for the scope, every team's, with whether each is claimed.
	rows, err := dayLogs(tx, report, key, in.Day)
	if err != nil {
		return result, err
	}

	for _, row := range rows {
		_, ok := columnOfType(row.SettlementType)
		if !ok {
			return result, fmt.Errorf("settlement re-fold: log row %d has settlement_type %q, which has no report column", row.ID, row.SettlementType)
		}
	}

	// 3 · CLAIM THE LOST ROWS — before any advisory lock, as the fold claims before its locks. A fold redelivering one of
	// them right now holds its claim uncommitted; this insert waits for it, and its DO NOTHING keeps whichever came first.
	short := []uint64{}

	for i := range rows {
		if rows[i].Claimed || !rows[i].Old {
			continue
		}

		claimed, err := claimLogRow(tx, rows[i])
		if err != nil {
			return result, err
		}

		if claimed {
			result.Claimed++
			short = append(short, rows[i].OtherKey)
		}
	}

	slices.Sort(short)
	result.Short = slices.Compact(short)

	// 4 · ONE ADVISORY LOCK PER (scope, team), the fold's own key, in team order.
	teams, err := dayTeams(tx, report, key, in.Day, rows)
	if err != nil {
		return result, err
	}

	for _, teamID := range teams {
		err = advisoryLock(tx, report.lock+strconv.FormatUint(teamID, 10)+":"+strconv.FormatUint(key, 10))
		if err != nil {
			return result, err
		}
	}

	// 5 · UNDER THE LOCKS, what counts is every row with a visible claim — the fold's, or one a re-fold wrote. An
	// unclaimed row now is in flight: the fold adds it after this commits.
	counted, err := dayLogs(tx, report, key, in.Day)
	if err != nil {
		return result, err
	}

	for _, row := range counted {
		if row.Claimed {
			result.Counted++
		} else {
			result.InFlight++
		}
	}

	for _, teamID := range teams {
		team, err := refoldTeam(tx, report, key, teamID, in.Day, counted)
		if err != nil {
			return result, err
		}

		result.Teams = append(result.Teams, team)
	}

	return result, nil
}

// dayLogs reads one scope's log rows of one posted day, oldest first, each with its claim, its age and its key in the
// other report.
func dayLogs(tx *gorm.DB, report refoldReport, key uint64, day string) ([]refoldLog, error) {
	rows := []refoldLog{}

	query := fmt.Sprintf(`
SELECT l.*,
       EXISTS (SELECT 1 FROM settlement_event_logs e WHERE e.id = 'settlement-log:' || l.id) AS claimed,
       l.created_at < NOW() - CAST(@inflight AS interval) AS old,
       COALESCE(o.created_by_user_id, 0) AS created_by_user_id,
       %[2]s AS other_key
FROM settlement_logs l
LEFT JOIN order_settlements o ON o.order_id = l.order_id
WHERE %[1]s AND l.posted_on = CAST(@day AS date)
ORDER BY l.id`, report.scope, report.otherKey)

	err := tx.
		Raw(query, map[string]any{"inflight": refoldInFlight, "key": key, "day": day}).
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("settlement re-fold: read the day's log: %w", err)
	}

	return rows, nil
}

// claimLogRow writes the fold's claim for a row whose event never arrived — the event the post published, built by the
// same function, so a redelivery of it collides here. False when a fold or another re-fold claimed it first.
func claimLogRow(tx *gorm.DB, row refoldLog) (bool, error) {
	entry := row.SettlementLog

	event := postedEvent(PostResult{
		Entry: entry,
		State: &settlement_service_models.OrderSettlement{CreatedByUserID: row.CreatedByUserID},
	})

	raw, err := san_event.Marshal(event)
	if err != nil {
		return false, err
	}

	claim := tx.Exec(
		`INSERT INTO settlement_event_logs (id, raw, day) VALUES (?, ?, CAST(? AS date)) ON CONFLICT (id) DO NOTHING`,
		event.GetEventId(), raw, entry.PostedOn.Format(dateLayout),
	)
	if claim.Error != nil {
		return false, fmt.Errorf("settlement re-fold: claim log row %d: %w", entry.ID, claim.Error)
	}

	return claim.RowsAffected == 1, nil
}

// dayTeams is every team the scope has a log row or a report row for on the day, in order.
func dayTeams(tx *gorm.DB, report refoldReport, key uint64, day string, rows []refoldLog) ([]uint64, error) {
	stored := []uint64{}

	query := fmt.Sprintf(`SELECT team_id FROM %[1]s WHERE %[2]s = ? AND day = CAST(? AS date)`, report.grain.table, report.grain.key)

	err := tx.
		Raw(query, key, day).
		Scan(&stored).
		Error
	if err != nil {
		return nil, fmt.Errorf("settlement re-fold: read the day's report rows: %w", err)
	}

	teams := stored
	for _, row := range rows {
		teams = append(teams, row.TeamID)
	}

	slices.Sort(teams)

	return slices.Compact(teams), nil
}

// refoldTeam rewrites one (scope, team)'s row of the day from its claimed log rows, shifts every later day's carry by
// how far the day's close moved, and re-derives the scope's state row.
func refoldTeam(tx *gorm.DB, report refoldReport, key, teamID uint64, day string, rows []refoldLog) (DayRefoldTeam, error) {
	out := DayRefoldTeam{TeamID: teamID}
	grain := report.grain
	args := map[string]any{"day": day, "key": key, "team": teamID}

	before, err := storedDay(tx, grain, key, teamID, day)
	if err != nil {
		return out, err
	}

	out.Before = before

	// THE OPEN is the scope's last row before the day, as the fold opens a new day.
	var open float64

	err = tx.
		Raw(fmt.Sprintf(`
SELECT COALESCE((SELECT p.close_balance FROM %[1]s p
                 WHERE p.%[2]s = @key AND p.team_id = @team AND p.day < CAST(@day AS date)
                 ORDER BY p.day DESC LIMIT 1), 0)`, grain.table, grain.key), args).
		Scan(&open).
		Error
	if err != nil {
		return out, fmt.Errorf("settlement re-fold: read the open: %w", err)
	}

	var after settlement_service_models.SettlementMetricColumns

	moved := false

	for _, row := range rows {
		if row.TeamID != teamID || !row.Claimed {
			continue
		}

		moved = true

		addToColumn(&after, row.SettlementType, row.Change)
		after.Change += row.Change
	}

	// WHAT THE LATER DAYS CARRIED from this day: its stored close — or, when it had no row, the open it would have had.
	carried := open
	if before != nil {
		carried = before.CloseBalance
	}

	closed := open

	if !moved {
		// A DAY WITH NO MOVEMENT HAS NO ROW (00005).
		err = tx.
			Exec(fmt.Sprintf(`DELETE FROM %[1]s WHERE %[2]s = @key AND team_id = @team AND day = CAST(@day AS date)`, grain.table, grain.key), args).
			Error
		if err != nil {
			return out, fmt.Errorf("settlement re-fold: remove the day's row: %w", err)
		}
	} else {
		after.OpenBalance = open
		after.CloseBalance = open + after.Change
		out.After = &after
		closed = after.CloseBalance

		// A row that already matches the log is left as it is — `last_updated` included — so a second run writes nothing.
		// Matched with san_money's tolerance, never == on a double (every-ledger-moves-to-double-rounded-when-frozen).
		if before == nil || !sameFigures(*before, after) {
			err = upsertDay(tx, grain, key, teamID, day, after)
			if err != nil {
				return out, err
			}
		}
	}

	// THE LATER DAYS — shifted by exactly how far this day's close moved, the fold's own shift for a late event
	// (a-refold-shifts-the-later-days). Their movement is theirs and is not touched; a second run moves nothing.
	out.CarryDelta = closed - carried

	if !san_money.IsZero(out.CarryDelta) {
		out.LaterDays, err = shiftLaterDays(tx, grain, key, teamID, day, out.CarryDelta)
		if err != nil {
			return out, fmt.Errorf("settlement re-fold: %s later days: %w", grain.table, err)
		}
	}

	// THE STATE ROW — re-derived from the newest daily row, after the shift: the fold's own statement, except that the
	// person's `last_day` is recomputed, since a re-fold can remove the newest day.
	err = deriveState(tx, grain, report.stateTable, report.keepsLastDay, lastDayRecomputed, key, teamID)
	if err != nil {
		return out, fmt.Errorf("settlement re-fold: %s: %w", report.stateTable, err)
	}

	err = clearEmptyState(tx, report, key, teamID)
	if err != nil {
		return out, err
	}

	// THE NEXT ROW — whether its open now meets this day's close.
	next := []struct {
		Day         time.Time
		OpenBalance float64
	}{}

	err = tx.
		Raw(fmt.Sprintf(`
SELECT day, open_balance FROM %[1]s
WHERE %[2]s = @key AND team_id = @team AND day > CAST(@day AS date)
ORDER BY day
LIMIT 1`, grain.table, grain.key), args).
		Scan(&next).
		Error
	if err != nil {
		return out, fmt.Errorf("settlement re-fold: read the next day: %w", err)
	}

	if len(next) == 1 {
		out.NextDay = next[0].Day.Format(dateLayout)
		out.NextGap = next[0].OpenBalance - closed
	}

	return out, nil
}

// clearEmptyState zeroes the state row of a scope the re-fold left with no daily row at all — its position is 0, and
// a person on no figure has no `last_day` (the person list skips them, as after a replay's cut). deriveState writes
// nothing for such a scope, so without this its state row would keep the removed day's close.
func clearEmptyState(tx *gorm.DB, report refoldReport, key, teamID uint64) error {
	set := "close_balance = 0, last_updated = NOW()"
	if report.keepsLastDay {
		set = "close_balance = 0, last_day = NULL, last_updated = NOW()"
	}

	statement := fmt.Sprintf(`
UPDATE %[3]s s
SET %[4]s
WHERE s.%[2]s = @key AND s.team_id = @team
  AND NOT EXISTS (SELECT 1 FROM %[1]s r WHERE r.%[2]s = @key AND r.team_id = @team)`,
		report.grain.table, report.grain.key, report.stateTable, set)

	err := tx.Exec(statement, map[string]any{"key": key, "team": teamID}).Error
	if err != nil {
		return fmt.Errorf("settlement re-fold: %s of an emptied scope: %w", report.stateTable, err)
	}

	return nil
}

func storedDay(tx *gorm.DB, grain reportGrain, key, teamID uint64, day string) (*settlement_service_models.SettlementMetricColumns, error) {
	rows := []settlement_service_models.SettlementMetricColumns{}

	query := fmt.Sprintf(`SELECT * FROM %[1]s WHERE %[2]s = ? AND team_id = ? AND day = CAST(? AS date)`, grain.table, grain.key)

	err := tx.
		Raw(query, key, teamID, day).
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("settlement re-fold: read the stored day: %w", err)
	}

	if len(rows) == 0 {
		return nil, nil
	}

	return &rows[0], nil
}

// upsertDay REPLACES the day's row: every movement column, the change and the position are the log's, none added to.
func upsertDay(tx *gorm.DB, grain reportGrain, key, teamID uint64, day string, c settlement_service_models.SettlementMetricColumns) error {
	values := columnValues(c)

	columns := append(append([]string{}, trackedColumns...), "change", "open_balance", "close_balance")
	sets := make([]string, 0, len(columns))
	params := make([]string, 0, len(columns))

	for _, column := range columns {
		sets = append(sets, column+" = EXCLUDED."+column)
		params = append(params, "@"+column)
	}

	values["day"] = day
	values["key"] = key
	values["team"] = teamID

	statement := fmt.Sprintf(`
INSERT INTO %[4]s (day, %[5]s, team_id, %[1]s, last_updated)
VALUES (CAST(@day AS date), @key, @team, %[2]s, NOW())
ON CONFLICT (%[5]s, team_id, day) DO UPDATE
SET %[3]s,
    last_updated = NOW()`,
		strings.Join(columns, ", "), strings.Join(params, ", "), strings.Join(sets, ",\n    "), grain.table, grain.key)

	err := tx.Exec(statement, values).Error
	if err != nil {
		return fmt.Errorf("settlement re-fold: write the day's row: %w", err)
	}

	return nil
}

// columnValues names every stored figure by its column.
func columnValues(c settlement_service_models.SettlementMetricColumns) map[string]any {
	return map[string]any{
		typeInitialTotal:          c.InitialTotal,
		typeInitialTotalCancel:    c.InitialTotalCancel,
		typeOther:                 c.Other,
		typeFund:                  c.Fund,
		typeExternalAdsFee:        c.ExternalAdsFee,
		typeAffiliateFee:          c.AffiliateFee,
		typeMarketplaceAdjust:     c.MarketplaceAdjustment,
		typeSystemAdjustment:      c.SystemAdjustment,
		typeWithdrawal:            c.Withdrawal,
		typeShipmentAdjustment:    c.ShipmentAdjustment,
		typeLogisticReimbursement: c.LogisticReimbursement,
		typePlatformReimbursement: c.PlatformReimbursement,
		typeMarketplaceProgram:    c.MarketplaceProgram,
		"change":                  c.Change,
		"open_balance":            c.OpenBalance,
		"close_balance":           c.CloseBalance,
	}
}

// addToColumn adds a log row's change to the column its type folds into.
func addToColumn(c *settlement_service_models.SettlementMetricColumns, typeText string, change float64) {
	switch typeText {
	case typeInitialTotal:
		c.InitialTotal += change
	case typeInitialTotalCancel:
		c.InitialTotalCancel += change
	case typeOther:
		c.Other += change
	case typeFund:
		c.Fund += change
	case typeExternalAdsFee:
		c.ExternalAdsFee += change
	case typeAffiliateFee:
		c.AffiliateFee += change
	case typeMarketplaceAdjust:
		c.MarketplaceAdjustment += change
	case typeSystemAdjustment:
		c.SystemAdjustment += change
	case typeWithdrawal:
		c.Withdrawal += change
	case typeShipmentAdjustment:
		c.ShipmentAdjustment += change
	case typeLogisticReimbursement:
		c.LogisticReimbursement += change
	case typePlatformReimbursement:
		c.PlatformReimbursement += change
	case typeMarketplaceProgram:
		c.MarketplaceProgram += change
	}
}

func sameColumns(a, b *settlement_service_models.SettlementMetricColumns) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	return sameFigures(*a, *b)
}

// sameFigures says whether two report rows hold the same figures — every column compared with san_money.Equal, never
// == on a double (every-ledger-moves-to-double-rounded-when-frozen). columnValues names every figure, so a column
// added to the report is compared with no second edit.
func sameFigures(a, b settlement_service_models.SettlementMetricColumns) bool {
	right := columnValues(b)

	for column, value := range columnValues(a) {
		if !san_money.Equal(value.(float64), right[column].(float64)) {
			return false
		}
	}

	return true
}
