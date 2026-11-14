package main

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"

	"github.com/urfave/cli/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// supplierBackfillWarehousesCommand is `san supplier backfill-warehouses` — both supplier daily reports re-folded into
// the warehouse each figure came from (the-supplier-reports-carry-the-warehouse): the rows supplier_service's 00006 filed
// under no warehouse (0), re-read from history through supplier_service's own methods.
func supplierBackfillWarehousesCommand() *cli.Command {
	return &cli.Command{
		Name:      "backfill-warehouses",
		Usage:     "re-fold the supplier daily reports into the warehouse each figure came from, and prove every supplier's totals unchanged",
		ArgsUsage: " ",
		Description: "Repeatable. Since supplier_service 00006 both supplier daily reports are keyed by the warehouse — a restock\n" +
			"line's receiving warehouse, an order line's taking warehouse — and every row folded before that sits under\n" +
			"warehouse 0 (still counted with no warehouse chip). This command, in order:\n" +
			"  1. files every Penjualan part under 0 under the warehouse its units were taken from — the order's placement\n" +
			"     read from selling, its take from inventory, priced again by the sales fold's own arithmetic; a take that\n" +
			"     no longer adds up to the part keeps the part's figures under the warehouse the order shipped from;\n" +
			"  2. re-folds every supplier day of either report still holding a row under 0, through `report refold`'s own\n" +
			"     method (the fold's claims, its lock, keyed by warehouse), and every other supplier day such a re-fold\n" +
			"     leaves short;\n" +
			"  3. prints every supplier's totals over every day and warehouse BEFORE and AFTER — they must be equal; only an\n" +
			"     event the fold never received, claimed by a re-fold, moves them, and the output says so.\n" +
			"--dry-run runs it all in ONE transaction and rolls it back — the AFTER it prints is what a real run writes; the\n" +
			"transaction holds both reports' fold lock until it ends, so live folds wait for it. A second run finds\n" +
			"nothing under 0 and writes nothing.",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "dry-run", Usage: "run everything in one transaction, print it, roll it back"},
		},
		Action: runSupplierBackfillWarehouses,
	}
}

func runSupplierBackfillWarehouses(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		report, err := san.BackfillSupplierWarehouses(ctx, cmd.Bool("dry-run"))
		if err != nil {
			return err
		}

		printWarehouseBackfill(os.Stdout, san.target, report)

		return nil
	})
}

// WarehouseBackfillReport is what `supplier backfill-warehouses` found and did.
type WarehouseBackfillReport struct {
	DryRun bool
	// Every supplier's totals over every day and warehouse, before and after.
	Before, After map[uint64]supplier_v1.SupplierTotals
	Parts         supplier_v1.SalePartBackfillResult
	Refolds       []LinkRefold
}

// Moved lists the suppliers whose totals differ before and after, in id order.
func (r WarehouseBackfillReport) Moved() []uint64 {
	ids := supplierIDsOf(r.Before, r.After)

	moved := []uint64{}

	for _, id := range ids {
		if !r.Before[id].Same(r.After[id]) {
			moved = append(moved, id)
		}
	}

	return moved
}

// Claimed is how many events nobody had claimed the re-folds claimed and counted — the only thing that may move a total.
func (r WarehouseBackfillReport) Claimed() int {
	n := 0
	for _, refold := range r.Refolds {
		n += refold.Result.Claimed
	}

	return n
}

// BackfillSupplierWarehouses files the Penjualan parts, re-folds every supplier day holding a row under no warehouse
// (and every day those re-folds leave short), and reads every supplier's totals before and after. A dry run does all of
// it in ONE transaction it rolls back, so its AFTER is exactly what a real run writes.
func (s *San) BackfillSupplierWarehouses(ctx context.Context, dryRun bool) (WarehouseBackfillReport, error) {
	if !dryRun {
		return s.backfillSupplierWarehouses(ctx, false)
	}

	report := WarehouseBackfillReport{DryRun: true}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		run := &San{db: tx, suppliers: NewSupplierFigures(tx, NewReleaseInventory(tx)), target: s.target}

		var err error

		report, err = run.backfillSupplierWarehouses(ctx, true)
		if err != nil {
			return err
		}

		return errWarehouseDryRun
	})
	if errors.Is(err, errWarehouseDryRun) {
		return report, nil
	}

	return report, err
}

// errWarehouseDryRun rolls the dry run's one transaction back after everything was read.
var errWarehouseDryRun = errors.New("dry run")

func (s *San) backfillSupplierWarehouses(ctx context.Context, dryRun bool) (WarehouseBackfillReport, error) {
	report := WarehouseBackfillReport{DryRun: dryRun}

	var err error

	report.Before, err = s.suppliers.ReportTotals(ctx)
	if err != nil {
		return report, err
	}

	logs := refoldLogs{db: s.db}

	report.Parts, err = s.suppliers.SalePartWarehouses(ctx, logs)
	if err != nil {
		return report, err
	}

	days, err := s.suppliers.UnplacedReportDays(ctx)
	if err != nil {
		return report, err
	}

	done := map[supplier_v1.UnplacedDay]bool{}

	for len(days) > 0 {
		day := days[0]
		days = days[1:]

		if done[day] {
			continue
		}

		done[day] = true

		in := supplier_v1.DayRefoldInput{Report: day.Report, SupplierID: day.SupplierID, Day: day.Day}

		result, err := s.suppliers.DayRefold(ctx, in, logs)
		if err != nil {
			return report, fmt.Errorf("re-fold %s · supplier %d · %s: %w", day.Report, day.SupplierID, day.Day, err)
		}

		in.DryRun = dryRun
		report.Refolds = append(report.Refolds, LinkRefold{In: in, Result: result})

		// A lost event this re-fold claimed also counts for these supplier days — re-fold them too, or their totals
		// would be short of it.
		for _, short := range result.Short {
			days = append(days, supplier_v1.UnplacedDay{Report: day.Report, SupplierID: short.SupplierID, Day: short.Day})
		}
	}

	report.After, err = s.suppliers.ReportTotals(ctx)
	if err != nil {
		return report, err
	}

	return report, nil
}

// printWarehouseBackfill writes what the backfill found and did, and every supplier's totals before and after.
func printWarehouseBackfill(w io.Writer, target string, report WarehouseBackfillReport) {
	fmt.Fprintf(w, "[%s] supplier backfill-warehouses · %s\n", target, warehouseBackfillMode(report.DryRun))

	parts := report.Parts
	if parts.Orders == 0 {
		fmt.Fprintln(w, "  Penjualan parts under no warehouse: none")
	} else {
		fmt.Fprintf(w, "  Penjualan parts under no warehouse: %d order(s) — %d from their take, %d under the order's warehouse, %d not in the log (left)\n",
			parts.Orders, parts.FromTake, parts.FromOrder, parts.Unresolved)
	}

	if len(report.Refolds) == 0 {
		fmt.Fprintln(w, "  supplier days with a row under no warehouse: none — nothing to re-fold")
	} else {
		fmt.Fprintf(w, "  supplier days re-folded: %d\n", len(report.Refolds))
	}

	for _, refold := range report.Refolds {
		before, after, unplaced := 0, 0, 0

		for _, row := range refold.Result.Rows {
			if row.Before != nil {
				before++

				if row.WarehouseID == 0 {
					unplaced++
				}
			}

			if row.After != nil {
				after++
			}
		}

		fmt.Fprintf(w, "    %s · supplier %d · %s: events %d · lost and now claimed %d · rows %d → %d (%d under no warehouse before)\n",
			refold.In.Report, refold.In.SupplierID, refold.In.Day, refold.Result.Counted, refold.Result.Claimed, before, after, unplaced)
	}

	ids := supplierIDsOf(report.Before, report.After)
	if len(ids) == 0 {
		fmt.Fprintln(w, "  no supplier has figures")

		return
	}

	fmt.Fprintln(w, "  every supplier's totals, every day and warehouse — BEFORE → AFTER:")

	for _, id := range ids {
		before, after := report.Before[id], report.After[id]

		verdict := "= unchanged"
		if !before.Same(after) {
			verdict = "≠ MOVED"
		}

		fmt.Fprintf(w, "    supplier %d  %s\n", id, verdict)
		fmt.Fprintf(w, "      before  %s · rows under no warehouse %d\n", totalsLine(before), before.UnplacedRows)
		fmt.Fprintf(w, "      after   %s · rows under no warehouse %d\n", totalsLine(after), after.UnplacedRows)
	}

	moved := report.Moved()

	switch {
	case len(moved) == 0:
		fmt.Fprintln(w, "  ✓ every supplier's totals are unchanged — with no warehouse chip, Statistik reads what it read before")
	case report.Claimed() > 0:
		fmt.Fprintf(w, "  ⚠ %d supplier(s) moved: the re-folds claimed %d event(s) the fold never received and counted them — a repair, not the backfill\n",
			len(moved), report.Claimed())
	default:
		fmt.Fprintf(w, "  ✗ %d supplier(s) moved with no event claimed — the report did not match its claims; read the rows above\n", len(moved))
	}
}

func totalsLine(t supplier_v1.SupplierTotals) string {
	return fmt.Sprintf("restock %d · %s  lost %d · %s  broken %d · %s  sales %d · %s",
		t.RestockCount, rupiahText(t.RestockValuation), t.ShippingLostCount, rupiahText(t.ShippingLostValuation),
		t.ShippingBrokenCount, rupiahText(t.ShippingBrokenValuation), t.SalesCount, rupiahText(t.SalesValue))
}

// rupiahText is a figure as stored — exact, never rounded (the-backend-never-rounds-money).
func rupiahText(v float64) string {
	return "Rp " + strconv.FormatFloat(v, 'f', -1, 64)
}

func supplierIDsOf(maps ...map[uint64]supplier_v1.SupplierTotals) []uint64 {
	seen := map[uint64]bool{}
	ids := []uint64{}

	for _, m := range maps {
		for id := range m {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}

	slices.SortFunc(ids, func(a, b uint64) int { return cmp.Compare(a, b) })

	return ids
}

func warehouseBackfillMode(dryRun bool) string {
	if dryRun {
		return "DRY RUN — one transaction, rolled back"
	}

	return "written"
}

// backfillWarehousesOn is the `dev setup` step — the same method the command runs, on setup's connection. Repeatable,
// so a second setup prints "nothing to re-fold".
func backfillWarehousesOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	san := &San{db: gdb, suppliers: NewSupplierFigures(gdb, NewReleaseInventory(gdb)), target: target}

	report, err := san.BackfillSupplierWarehouses(ctx, false)
	if err != nil {
		return err
	}

	fmt.Printf("  %d order(s) filed · %d supplier day(s) re-folded · %d supplier(s) moved\n",
		report.Parts.Orders, len(report.Refolds), len(report.Moved()))

	return nil
}
