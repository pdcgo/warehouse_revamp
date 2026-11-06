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

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// NewSettlementReports is settlement_service as the operations tool needs it: the day re-fold and nothing else. No
// sender — the re-fold publishes nothing — no broker, no shop lookup, no order marker.
func NewSettlementReports(db *gorm.DB) *settlement_v1.Service {
	return settlement_v1.NewService(db, nil, nil, nil, nil)
}

var (
	errRefoldShopFlag = errors.New("--report " + settlement_v1.ReportShopDaily + " re-folds one shop: give --shop, not --user")
	errRefoldUserFlag = errors.New("--report " + settlement_v1.ReportUserDaily + " re-folds one person: give --user, not --shop")
)

// reportCommand is the reports' operator actions: today, the day re-fold of a-wrong-day-is-refolded-from-the-log, for
// the shop report and the person report (the-person-report-refolds-too).
func reportCommand() *cli.Command {
	return &cli.Command{
		Name:  "report",
		Usage: "report repairs",
		Commands: []*cli.Command{
			{
				Name:      "refold",
				Usage:     "rebuild one shop's or one person's day of a settlement report from the log — the repair for a day that is wrong while the log is right",
				ArgsUsage: " ",
				Description: "a-wrong-day-is-refolded-from-the-log: one report, one scope, one date. Re-reads that day's settlement_logs\n" +
					"rows (posted_on = --date) and REPLACES that day's report row with what they add up to; adds no log row.\n" +
					"Every later day's stored open/close shifts by how far the day's close moved (a-refold-shifts-the-later-days);\n" +
					"their movement is not touched. A row whose event was lost (never folded, written over an hour ago) is\n" +
					"counted and its event claimed, so a late redelivery folds nothing — the OTHER report is then short by it\n" +
					"until its own re-fold runs, and the output names the command. A row written within the hour is left to the\n" +
					"fold. --dry-run prints the same before/after and writes nothing. Run it again and it changes nothing.\n\n" +
					"  --report " + settlement_v1.ReportShopDaily + " --shop <id>   the shop report\n" +
					"  --report " + settlement_v1.ReportUserDaily + " --user <id>   the person report (the-person-report-refolds-too)",
				Flags: []cli.Flag{
					&cli.StringFlag{Name: "report", Required: true, Usage: "the report to rebuild: " + settlement_v1.ReportShopDaily + " or " + settlement_v1.ReportUserDaily},
					&cli.Uint64Flag{Name: "shop", Usage: "the shop id — for " + settlement_v1.ReportShopDaily},
					&cli.Uint64Flag{Name: "user", Usage: "the person's user id — for " + settlement_v1.ReportUserDaily + " (0 is the row of \"not recorded\")"},
					&cli.StringFlag{Name: "date", Required: true, Usage: "the Jakarta day, yyyy-mm-dd"},
					&cli.BoolFlag{Name: "dry-run", Usage: "print what would be written, write nothing"},
				},
				Action: runReportRefold,
			},
		},
	}
}

func runReportRefold(ctx context.Context, cmd *cli.Command) error {
	in, err := refoldInput(cmd.String("report"), cmd.IsSet("shop"), cmd.Uint64("shop"), cmd.IsSet("user"), cmd.Uint64("user"))
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
