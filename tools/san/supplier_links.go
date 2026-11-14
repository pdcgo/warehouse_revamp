package main

import (
	"cmp"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"slices"

	"github.com/urfave/cli/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// supplierBackfillLinksCommand is `san supplier backfill-links` — the supplier–product links
// (restock-accepted-links-the-product-to-its-channel) rebuilt from every accepted restock, and the figures the fold's
// switch to each LINE's supplier changes (the-supplier-comes-from-the-restock-until-lines-name-a-store) re-folded.
func supplierBackfillLinksCommand() *cli.Command {
	return &cli.Command{
		Name:      "backfill-links",
		Usage:     "rebuild the supplier–product links from every accepted restock, and re-fold the figures a mixed restock never got",
		ArgsUsage: " ",
		Description: "Repeatable. Reads every accepted restock that names a supplier on a line from inventory_service, builds\n" +
			"the RestockAccepted its accept sends, and writes each line's link (its own product, under its store or\n" +
			"under the supplier with no store) through supplier_service's own link write — the fold's: the earliest\n" +
			"and the latest accept per link, never lowered. A second run writes nothing.\n" +
			"Then, for every accept whose lines name a supplier while the restock as a whole named none (a restock\n" +
			"mixing suppliers — the fold credited nobody before it read each line's own), it re-folds each supplier's\n" +
			"restock figures on the accept's day and on every day the restock's received count was corrected, through\n" +
			"`report refold --report supplier-restock-daily`'s own method. --dry-run computes and prints it all, writes\n" +
			"nothing.",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "dry-run", Usage: "compute and print everything, write nothing"},
		},
		Action: runSupplierBackfillLinks,
	}
}

func runSupplierBackfillLinks(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		report, err := san.BackfillSupplierLinks(ctx, cmd.Bool("dry-run"))
		if err != nil {
			return err
		}

		printLinkBackfill(os.Stdout, san.target, report)

		return nil
	})
}

// LinkBackfillReport is what `supplier backfill-links` found and did: the links, then every supplier day it re-folded.
type LinkBackfillReport struct {
	Links   supplier_v1.LinkBackfillResult
	Refolds []LinkRefold
}

// LinkRefold is one supplier day the line-supplier switch changes, and what its re-fold did.
type LinkRefold struct {
	In     supplier_v1.DayRefoldInput
	Result supplier_v1.DayRefoldResult
}

// BackfillSupplierLinks writes the links of every accepted restock, then re-folds the supplier days of the restocks the
// line-supplier switch changes — the same two methods the fold and `report refold` run.
func (s *San) BackfillSupplierLinks(ctx context.Context, dryRun bool) (LinkBackfillReport, error) {
	report := LinkBackfillReport{}

	links, err := s.suppliers.LinkBackfill(ctx, acceptedRestockEvents(s.db.WithContext(ctx)), dryRun)
	if err != nil {
		return report, err
	}

	report.Links = links

	if len(links.Switched) == 0 {
		return report, nil
	}

	ids := make([]uint64, 0, len(links.Switched))
	for _, restock := range links.Switched {
		ids = append(ids, restock.RestockID)
	}

	// A correction of such a restock moved its suppliers' figures on its own day — re-fold those days too.
	corrected, err := inventory_v1.RestockCountCorrectionDays(s.db.WithContext(ctx), ids)
	if err != nil {
		return report, err
	}

	days := map[supplier_v1.ShortScope]bool{}

	for _, restock := range links.Switched {
		for _, supplier := range restock.Suppliers {
			days[supplier_v1.ShortScope{SupplierID: supplier, Day: restock.Day}] = true

			for _, day := range corrected[restock.RestockID] {
				days[supplier_v1.ShortScope{SupplierID: supplier, Day: day}] = true
			}
		}
	}

	scopes := make([]supplier_v1.ShortScope, 0, len(days))
	for scope := range days {
		scopes = append(scopes, scope)
	}

	slices.SortFunc(scopes, func(a, b supplier_v1.ShortScope) int {
		return cmp.Or(cmp.Compare(a.SupplierID, b.SupplierID), cmp.Compare(a.Day, b.Day))
	})

	for _, scope := range scopes {
		in := supplier_v1.DayRefoldInput{
			Report: supplier_v1.ReportRestockDaily, SupplierID: scope.SupplierID, Day: scope.Day, DryRun: dryRun,
		}

		result, err := s.SupplierReportRefold(ctx, in)
		if err != nil {
			return report, fmt.Errorf("re-fold supplier %d on %s: %w", scope.SupplierID, scope.Day, err)
		}

		report.Refolds = append(report.Refolds, LinkRefold{In: in, Result: result})
	}

	return report, nil
}

// printLinkBackfill writes what the backfill found and did.
func printLinkBackfill(w io.Writer, target string, report LinkBackfillReport) {
	links := report.Links

	fmt.Fprintf(w, "[%s] supplier backfill-links · %s\n", target, linkBackfillMode(links.DryRun))
	fmt.Fprintf(w, "  accepted restocks %d · lines naming a supplier %d · links %d\n", links.Accepts, links.Lines, links.Links)
	fmt.Fprintf(w, "  links: %d new · %d dates moved · %d already right\n", links.Inserted, links.Moved, links.Unchanged)

	if len(links.Switched) == 0 {
		fmt.Fprintln(w, "  restocks mixing suppliers: none — the line-supplier switch changes no figure")

		return
	}

	fmt.Fprintf(w, "  restocks mixing suppliers: %d — their suppliers' restock figures, %d supplier day(s) re-folded:\n",
		len(links.Switched), len(report.Refolds))

	for _, refold := range report.Refolds {
		changed := 0

		for _, row := range refold.Result.Rows {
			if !sameFigures(row.Before, row.After) {
				changed++
			}
		}

		fmt.Fprintf(w, "    supplier %d · %s: events counted %d · lost and now claimed %d · in flight %d · rows changed %d\n",
			refold.In.SupplierID, refold.In.Day, refold.Result.Counted, refold.Result.Claimed, refold.Result.InFlight, changed)
	}
}

func linkBackfillMode(dryRun bool) string {
	if dryRun {
		return "DRY RUN — nothing written"
	}

	return "written"
}

// acceptedRestockEvents is a supplier backfill source over inventory's accepted restocks, in batches, oldest first —
// each as the very event its accept builds (one function, so a backfill cannot read a restock differently from how it
// was accepted).
func acceptedRestockEvents(db *gorm.DB) supplier_v1.BackfillSource {
	return func(each func(*eventsv1.Event) error) error {
		var batch []inventory_service_models.Restock

		return inventory_v1.AcceptedRestocks(db).
			FindInBatches(&batch, backfillBatch, func(_ *gorm.DB, _ int) error {
				for i := range batch {
					err := each(inventory_v1.RestockAcceptedEvent(&batch[i]))
					if err != nil {
						return err
					}
				}

				return nil
			}).
			Error
	}
}

// backfillLinksOn is the `dev setup` step — the same method the command runs, on setup's connection. Repeatable, so a
// second setup prints "0 new".
func backfillLinksOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	san := &San{db: gdb, suppliers: NewSupplierFigures(gdb, NewReleaseInventory(gdb)), target: target}

	report, err := san.BackfillSupplierLinks(ctx, false)
	if err != nil {
		return err
	}

	fmt.Printf("  %d links: %d new, %d dates moved, %d already right · %d mixed restock(s), %d supplier day(s) re-folded\n",
		report.Links.Links, report.Links.Inserted, report.Links.Moved, report.Links.Unchanged,
		len(report.Links.Switched), len(report.Refolds))

	return nil
}
