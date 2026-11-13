package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/urfave/cli/v3"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// NewSettlementReports is settlement_service as the operations tool needs it: the day re-fold and nothing else. No
// sender — the re-fold publishes nothing — no broker, no shop lookup, no order marker.
func NewSettlementReports(db *gorm.DB) *settlement_v1.Service {
	return settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)
}

// NewOrderReports is selling_service's order metrics as the operations tool needs them: the day re-fold. No team-type
// reader — the re-fold reads no metric for anybody.
func NewOrderReports(db *gorm.DB) *selling_v1.Analytic {
	return selling_v1.NewAnalytic(db, nil)
}

var (
	errRefoldShopFlag = errors.New("--report " + settlement_v1.ReportShopDaily + " re-folds one shop: give --shop, not --user")
	errRefoldUserFlag = errors.New("--report " + settlement_v1.ReportUserDaily + " re-folds one person: give --user, not --shop")
	errRefoldUnknown  = errors.New("the re-fold rebuilds " + strings.Join(refoldReports, ", "))
)

// refoldReports is every EVENT-FED daily report `report refold` rebuilds, and refoldScopes each one's scope flag — the
// report's own key. A report folded inside its writer's transaction cannot lose an event and has none.
var (
	refoldReports = []string{
		settlement_v1.ReportShopDaily, settlement_v1.ReportUserDaily, selling_v1.ReportOrderDaily,
		supplier_v1.ReportRestockDaily, supplier_v1.ReportSaleDaily,
	}
	refoldScopes = map[string]string{
		settlement_v1.ReportShopDaily:  "shop",
		settlement_v1.ReportUserDaily:  "user",
		selling_v1.ReportOrderDaily:    "team",
		supplier_v1.ReportRestockDaily: "supplier",
		supplier_v1.ReportSaleDaily:    "supplier",
	}
	refoldNouns = map[string]string{"shop": "shop", "user": "person", "team": "seller team", "supplier": "supplier"}
)

// refoldFlagsFit refuses a scope flag the report is not keyed by — before any database is asked for, so a wrong flag
// never prompts for Local/Production. `given` names the scope flags set.
func refoldFlagsFit(report string, given []string) error {
	scope, ok := refoldScopes[report]
	if !ok {
		return errRefoldUnknown
	}

	for _, flag := range given {
		if flag != scope {
			return fmt.Errorf("--report %s re-folds one %s: give --%s, not --%s", report, refoldNouns[scope], scope, flag)
		}
	}

	return nil
}

// reportCommand is the reports' operator actions: today, the day re-fold of a-wrong-day-is-refolded-from-the-log, for
// every event-fed daily report — settlement's shop and person reports (the-person-report-refolds-too), the order
// metrics, and a supplier's restock figures and Penjualan.
func reportCommand() *cli.Command {
	return &cli.Command{
		Name:  "report",
		Usage: "report repairs",
		Commands: []*cli.Command{
			{
				Name:      "refold",
				Usage:     "rebuild one scope's day of an event-fed report from its log — the repair for a day that is wrong while the log is right",
				ArgsUsage: " ",
				Description: "a-wrong-day-is-refolded-from-the-log: one report, one scope, one date. Re-reads that day's settlement_logs\n" +
					"rows (posted_on = --date) and REPLACES that day's report row with what they add up to; adds no log row.\n" +
					"Every later day's stored open/close shifts by how far the day's close moved (a-refold-shifts-the-later-days);\n" +
					"their movement is not touched. A row whose event was lost (never folded, written over an hour ago) is\n" +
					"counted and its event claimed, so a late redelivery folds nothing — the OTHER report is then short by it\n" +
					"until its own re-fold runs, and the output names the command. A row written within the hour is left to the\n" +
					"fold. --dry-run prints the same before/after and writes nothing. Run it again and it changes nothing.\n" +
					"The order and supplier reports carry no balance, so no later day moves; their lost events are claimed the\n" +
					"same way, and a Penjualan claim names the other suppliers' and days' re-folds it leaves short.\n\n" +
					"  --report " + settlement_v1.ReportShopDaily + " --shop <id>          the shop report\n" +
					"  --report " + settlement_v1.ReportUserDaily + " --user <id>          the person report (the-person-report-refolds-too)\n" +
					"  --report " + selling_v1.ReportOrderDaily + " --team <id>                    the order metrics of one seller team\n" +
					"  --report " + supplier_v1.ReportRestockDaily + " --supplier <id>   a supplier's restock, lost and broken figures\n" +
					"  --report " + supplier_v1.ReportSaleDaily + " --supplier <id>      a supplier's Penjualan",
				Flags: []cli.Flag{
					&cli.StringFlag{Name: "report", Required: true, Usage: "the report to rebuild: " + strings.Join(refoldReports, ", ")},
					&cli.Uint64Flag{Name: "shop", Usage: "the shop id — for " + settlement_v1.ReportShopDaily},
					&cli.Uint64Flag{Name: "user", Usage: "the person's user id — for " + settlement_v1.ReportUserDaily + " (0 is the row of \"not recorded\")"},
					&cli.Uint64Flag{Name: "team", Usage: "the seller team id — for " + selling_v1.ReportOrderDaily},
					&cli.Uint64Flag{Name: "supplier", Usage: "the supplier id — for " + supplier_v1.ReportRestockDaily + " and " + supplier_v1.ReportSaleDaily},
					&cli.StringFlag{Name: "date", Required: true, Usage: "the Jakarta day, yyyy-mm-dd"},
					&cli.BoolFlag{Name: "dry-run", Usage: "print what would be written, write nothing"},
				},
				Action: runReportRefold,
			},
		},
	}
}

func runReportRefold(ctx context.Context, cmd *cli.Command) error {
	report := cmd.String("report")

	given := []string{}

	for _, flag := range []string{"shop", "user", "team", "supplier"} {
		if cmd.IsSet(flag) {
			given = append(given, flag)
		}
	}

	switch report {
	case selling_v1.ReportOrderDaily:
		err := refoldFlagsFit(report, given)
		if err != nil {
			return err
		}

		return runOrderRefold(ctx, cmd, selling_v1.OrderDayRefoldInput{
			TeamID: cmd.Uint64("team"), Day: cmd.String("date"), DryRun: cmd.Bool("dry-run"),
		})
	case supplier_v1.ReportRestockDaily, supplier_v1.ReportSaleDaily:
		err := refoldFlagsFit(report, given)
		if err != nil {
			return err
		}

		return runSupplierRefold(ctx, cmd, supplier_v1.DayRefoldInput{
			Report: report, SupplierID: cmd.Uint64("supplier"), Day: cmd.String("date"), DryRun: cmd.Bool("dry-run"),
		})
	case settlement_v1.ReportShopDaily, settlement_v1.ReportUserDaily:
		// Settlement's own two flags keep their own words (errRefoldShopFlag, errRefoldUserFlag); a third is refused here.
		other := []string{}

		for _, flag := range given {
			if flag == "team" || flag == "supplier" {
				other = append(other, flag)
			}
		}

		err := refoldFlagsFit(report, other)
		if err != nil {
			return err
		}
	default:
		return errRefoldUnknown
	}

	in, err := refoldInput(report, cmd.IsSet("shop"), cmd.Uint64("shop"), cmd.IsSet("user"), cmd.Uint64("user"))
	if err != nil {
		return err
	}

	in.Day = cmd.String("date")
	in.DryRun = cmd.Bool("dry-run")

	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		result, err := san.ReportRefold(ctx, in)
		if errors.Is(err, settlement_v1.ErrRefoldLocked) {
			return fmt.Errorf("[%s] %w", san.target, err)
		}

		if err != nil {
			return err
		}

		printRefold(os.Stdout, san.target, in, result)

		return nil
	})
}

// refoldInput turns the flags into the re-fold's scope — before any database is asked for, so a wrong flag never
// prompts for Local/Production. An unknown --report is passed on: the service names the reports it knows.
func refoldInput(report string, shopSet bool, shop uint64, userSet bool, user uint64) (settlement_v1.DayRefoldInput, error) {
	in := settlement_v1.DayRefoldInput{Report: report}

	switch report {
	case settlement_v1.ReportShopDaily:
		if userSet {
			return in, errRefoldShopFlag
		}

		in.ShopID = shop
	case settlement_v1.ReportUserDaily:
		if shopSet {
			return in, errRefoldUserFlag
		}

		if userSet {
			in.UserID = &user
		}
	}

	return in, nil
}

// ReportRefold re-folds one day through settlement_service's own method — the fold's locks, its claim, its tables.
func (s *San) ReportRefold(ctx context.Context, in settlement_v1.DayRefoldInput) (settlement_v1.DayRefoldResult, error) {
	return s.settlement.DayRefold(ctx, in)
}

// scopeOf names the re-fold's scope as the flag that set it.
func scopeOf(in settlement_v1.DayRefoldInput) string {
	if in.UserID != nil {
		return fmt.Sprintf("user %d", *in.UserID)
	}

	return fmt.Sprintf("shop %d", in.ShopID)
}

// printRefold writes what the re-fold found, a table per team: every figure that is not zero before or after, then
// what moved on the later days, then which scopes of the other report are short.
func printRefold(w io.Writer, target string, in settlement_v1.DayRefoldInput, result settlement_v1.DayRefoldResult) {
	mode := "re-folded"
	if result.DryRun {
		mode = "DRY RUN — nothing written"
	}

	fmt.Fprintf(w, "[%s] %s · %s · %s · %s\n", target, in.Report, scopeOf(in), in.Day, mode)
	fmt.Fprintf(w, "  log rows counted %d · lost and now claimed %d · in flight, left to the fold %d\n",
		result.Counted, result.Claimed, result.InFlight)

	if len(result.Teams) == 0 {
		fmt.Fprintln(w, "  no log row and no report row on that day — nothing to do")

		return
	}

	for _, team := range result.Teams {
		state := "unchanged"

		switch {
		case team.Before == nil && team.After != nil:
			state = "row added"
		case team.Before != nil && team.After == nil:
			state = "row removed — the log holds nothing that day"
		case team.Before != nil && team.After != nil && !sameFigures(figuresOf(team.Before), figuresOf(team.After)):
			state = "row rewritten"
		}

		fmt.Fprintf(w, "  team %d: %s\n", team.TeamID, state)
		fmt.Fprintf(w, "    %-24s %14s %14s\n", "column", "before", "after")

		before, after := figuresOf(team.Before), figuresOf(team.After)

		for i, name := range refoldColumns {
			if san_money.IsZero(before[i]) && san_money.IsZero(after[i]) {
				continue
			}

			mark := ""
			if !san_money.Equal(before[i], after[i]) {
				mark = "  ←"
			}

			// Exact figures, written the screen's way — up to 3 decimals (a-fraction-of-a-rupiah-shows-three-decimals).
			fmt.Fprintf(w, "    %-24s %14s %14s%s\n", name, refoldFigure(before[i]), refoldFigure(after[i]), mark)
		}

		switch {
		case !san_money.IsZero(team.CarryDelta) && team.LaterDays > 0:
			fmt.Fprintf(w, "    later days: %d shifted by %s — open/close only, their movement untouched\n", team.LaterDays, signedFigure(team.CarryDelta))
		case !san_money.IsZero(team.CarryDelta):
			fmt.Fprintf(w, "    later days: none — the close moved by %s\n", signedFigure(team.CarryDelta))
		}

		if !san_money.IsZero(team.NextGap) {
			fmt.Fprintf(w, "    ⚠ the next day, %s, opens %s off this day's close — its carry was off before this re-fold; re-fold %s to close it\n",
				team.NextDay, signedFigure(team.NextGap), team.NextDay)
		}
	}

	if len(result.Short) > 0 {
		fmt.Fprintf(w, "  ⚠ %d row(s) were never folded: %s is still short by them — a redelivery no longer folds them. Run:\n",
			result.Claimed, result.OtherReport)

		flag := "--user"
		if result.OtherReport == settlement_v1.ReportShopDaily {
			flag = "--shop"
		}

		for _, key := range result.Short {
			fmt.Fprintf(w, "      go run ./tools/san report refold --report %s %s %d --date %s\n", result.OtherReport, flag, key, in.Day)
		}
	}
}

var refoldColumns = []string{
	"initial_total", "initial_total_cancel", "other", "fund", "external_ads_fee", "affiliate_fee",
	"marketplace_adjustment", "system_adjustment", "withdrawal", "shipment_adjustment", "logistic_reimbursement",
	"platform_reimbursement", "marketplace_program", "change", "open_balance", "close_balance",
}

func figuresOf(c *settlement_service_models.SettlementMetricColumns) []float64 {
	if c == nil {
		return make([]float64, len(refoldColumns))
	}

	return []float64{
		c.InitialTotal, c.InitialTotalCancel, c.Other, c.Fund, c.ExternalAdsFee, c.AffiliateFee,
		c.MarketplaceAdjustment, c.SystemAdjustment, c.Withdrawal, c.ShipmentAdjustment, c.LogisticReimbursement,
		c.PlatformReimbursement, c.MarketplaceProgram, c.Change, c.OpenBalance, c.CloseBalance,
	}
}

// refoldLine is printRefold's output as one string — for a test.
func refoldLine(target string, in settlement_v1.DayRefoldInput, result settlement_v1.DayRefoldResult) string {
	var b strings.Builder

	printRefold(&b, target, in, result)

	return b.String()
}

// sameFigures compares two rows' figures with san_money's tolerance, never == on a double
// (every-ledger-moves-to-double-rounded-when-frozen).
func sameFigures(before, after []float64) bool {
	for i := range before {
		if !san_money.Equal(before[i], after[i]) {
			return false
		}
	}

	return true
}

// refoldFigure writes an exact report figure for a person: Indonesian grouping, up to 3 decimals (san_money.Text without
// its "Rp "). Words only — the figures themselves are never rounded (the-backend-never-rounds-money).
func refoldFigure(v float64) string {
	return strings.TrimPrefix(san_money.Text(v), "Rp ")
}

// signedFigure is refoldFigure with both signs: "+1.500", "-0,5".
func signedFigure(v float64) string {
	text := refoldFigure(v)
	if strings.HasPrefix(text, "-") || text == "0" {
		return text
	}

	return "+" + text
}

// ── the order metrics — selling_service ────────────────────────────────────────────────────────────

func runOrderRefold(ctx context.Context, cmd *cli.Command, in selling_v1.OrderDayRefoldInput) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		result, err := san.OrderReportRefold(ctx, in)
		if err != nil {
			return err
		}

		printOrderRefold(os.Stdout, san.target, in, result)

		return nil
	})
}

// OrderReportRefold re-folds one seller team's day through selling_service's own method — the fold's claim, its lock,
// its table.
func (s *San) OrderReportRefold(ctx context.Context, in selling_v1.OrderDayRefoldInput) (selling_v1.OrderDayRefoldResult, error) {
	return s.orderReports.DayRefold(ctx, in)
}

var orderRefoldColumns = []string{"order_count", "total", "mp_total"}

func orderFigures(c *selling_service_models.OrderMetricColumns) []float64 {
	if c == nil {
		return nil
	}

	return []float64{float64(c.OrderCount), c.Total, c.MpTotal}
}

// printOrderRefold writes what the order re-fold found: a table per report row of the day.
func printOrderRefold(w io.Writer, target string, in selling_v1.OrderDayRefoldInput, result selling_v1.OrderDayRefoldResult) {
	fmt.Fprintf(w, "[%s] %s · team %d · %s · %s\n", target, selling_v1.ReportOrderDaily, in.TeamID, in.Day, refoldMode(result.DryRun))
	fmt.Fprintf(w, "  moves counted %d · lost and now claimed %d · in flight, left to the fold %d\n",
		result.Counted, result.Claimed, result.InFlight)

	if len(result.Rows) == 0 {
		fmt.Fprintln(w, "  no move and no report row on that day — nothing to do")

		return
	}

	for _, row := range result.Rows {
		label := fmt.Sprintf("%s · shop %d · warehouse %d · user %d", row.Metric, row.ShopID, row.WarehouseID, row.UserID)
		printRefoldRow(w, label, orderRefoldColumns, orderFigures(row.Before), orderFigures(row.After), "the orders hold nothing there")
	}
}

// ── a supplier's figures — supplier_service ────────────────────────────────────────────────────────

func runSupplierRefold(ctx context.Context, cmd *cli.Command, in supplier_v1.DayRefoldInput) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		result, err := san.SupplierReportRefold(ctx, in)
		if errors.Is(err, supplier_v1.ErrRefoldLocked) {
			return fmt.Errorf("[%s] %w", san.target, err)
		}

		if err != nil {
			return err
		}

		printSupplierRefold(os.Stdout, san.target, in, result)

		return nil
	})
}

// SupplierReportRefold re-folds one supplier's day through supplier_service's own method — the fold's claims, its lock,
// its tables — reading the log of inventory and selling through their own packages (refoldLogs).
func (s *San) SupplierReportRefold(ctx context.Context, in supplier_v1.DayRefoldInput) (supplier_v1.DayRefoldResult, error) {
	return s.suppliers.DayRefold(ctx, in, refoldLogs{db: s.db})
}

// refoldLogs is the supplier re-fold's RefoldSource: inventory's accepts and selling's orders, each read by its own
// service's function — what "accepted" and "placed on a day" are stored as stays theirs.
type refoldLogs struct {
	db *gorm.DB
}

// RestockAcceptsOn is the day's accepts AND its received-count corrections — both move a supplier's restock figures on
// their own day (a-received-count-correction-counts-on-its-own-day).
func (l refoldLogs) RestockAcceptsOn(ctx context.Context, day string) ([]*eventsv1.Event, error) {
	accepts, err := inventory_v1.RestockAcceptedEventsOn(l.db.WithContext(ctx), day)
	if err != nil {
		return nil, err
	}

	corrections, err := inventory_v1.RestockCountCorrectionEventsOn(l.db.WithContext(ctx), day)
	if err != nil {
		return nil, err
	}

	return append(accepts, corrections...), nil
}

func (l refoldLogs) OrderSalesOn(ctx context.Context, day string) ([]*eventsv1.Event, error) {
	return selling_v1.OrderSaleEventsOn(l.db.WithContext(ctx), day)
}

// refoldGoods is supplier_service's GoodsReader as the operations tool needs it: what an order's take drew, for pricing
// a lost sale the Penjualan re-fold claims — asked of inventory in-process, as the dev server's adapter does. The list's
// bands and a store's goods are a screen's questions, never asked here.
type refoldGoods struct {
	inventory *inventory_v1.Service
}

var errNotAnOperatorRead = errors.New("san reads no supplier list figures")

func (g refoldGoods) OrderTakeSuppliers(ctx context.Context, transactionID uint64) ([]supplier_v1.SaleTakePart, error) {
	rows, err := g.inventory.OrderTakeSuppliers(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	out := make([]supplier_v1.SaleTakePart, 0, len(rows))
	for _, row := range rows {
		out = append(out, supplier_v1.SaleTakePart{
			ProductID: row.ProductID, SupplierID: row.SupplierID, TeamID: row.TeamID, Units: row.Units,
		})
	}

	return out, nil
}

func (refoldGoods) SupplierIDsByFigure(context.Context, supplier_v1.GoodsFigure, int64, int64) ([]uint64, error) {
	return nil, errNotAnOperatorRead
}

func (refoldGoods) StoreGoods(context.Context, uint64) (map[uint64]supplier_v1.StoreGoods, error) {
	return nil, errNotAnOperatorRead
}

// printSupplierRefold writes what a supplier re-fold found: a table per product and team, then every other scope a
// claim made here leaves short, with its command.
func printSupplierRefold(w io.Writer, target string, in supplier_v1.DayRefoldInput, result supplier_v1.DayRefoldResult) {
	fmt.Fprintf(w, "[%s] %s · supplier %d · %s · %s\n", target, in.Report, in.SupplierID, in.Day, refoldMode(result.DryRun))
	fmt.Fprintf(w, "  events counted %d · lost and now claimed %d · in flight, left to the fold %d\n",
		result.Counted, result.Claimed, result.InFlight)

	if len(result.Rows) == 0 {
		fmt.Fprintln(w, "  no event and no report row on that day — nothing to do")
	}

	for _, row := range result.Rows {
		label := fmt.Sprintf("product %d · team %d", row.ProductID, row.TeamID)
		printRefoldRow(w, label, result.Columns, row.Before, row.After, "the log holds nothing there")
	}

	if len(result.Short) > 0 {
		fmt.Fprintf(w, "  ⚠ the lost sales claimed here also count for %d other supplier day(s) — a redelivery no longer adds them there. Run:\n",
			len(result.Short))

		for _, scope := range result.Short {
			fmt.Fprintf(w, "      go run ./tools/san report refold --report %s --supplier %d --date %s\n", in.Report, scope.SupplierID, scope.Day)
		}
	}
}

// ── shared by the order and supplier output ────────────────────────────────────────────────────────

func refoldMode(dryRun bool) string {
	if dryRun {
		return "DRY RUN — nothing written"
	}

	return "re-folded"
}

// printRefoldRow writes one report row: its state, then every figure that is not zero before or after, marked where it
// moved. nil figures are a row that is not there.
func printRefoldRow(w io.Writer, label string, columns []string, before, after []float64, removed string) {
	state := "unchanged"

	switch {
	case before == nil && after != nil:
		state = "row added"
	case before != nil && after == nil:
		state = "row removed — " + removed
	case before != nil && after != nil && !sameFigures(before, after):
		state = "row rewritten"
	}

	fmt.Fprintf(w, "  %s: %s\n", label, state)
	fmt.Fprintf(w, "    %-26s %14s %14s\n", "column", "before", "after")

	if before == nil {
		before = make([]float64, len(columns))
	}

	if after == nil {
		after = make([]float64, len(columns))
	}

	for i, name := range columns {
		if san_money.IsZero(before[i]) && san_money.IsZero(after[i]) {
			continue
		}

		mark := ""
		if !san_money.Equal(before[i], after[i]) {
			mark = "  ←"
		}

		fmt.Fprintf(w, "    %-26s %14s %14s%s\n", name, refoldFigure(before[i]), refoldFigure(after[i]), mark)
	}
}

// orderRefoldLine and supplierRefoldLine are the printers' output as one string — for a test.
func orderRefoldLine(target string, in selling_v1.OrderDayRefoldInput, result selling_v1.OrderDayRefoldResult) string {
	var b strings.Builder

	printOrderRefold(&b, target, in, result)

	return b.String()
}

func supplierRefoldLine(target string, in supplier_v1.DayRefoldInput, result supplier_v1.DayRefoldResult) string {
	var b strings.Builder

	printSupplierRefold(&b, target, in, result)

	return b.String()
}
