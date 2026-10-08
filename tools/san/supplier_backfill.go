package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"

	"github.com/urfave/cli/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// backfillBatch is how many accepted restocks are read at a time — the backfill never holds them all.
const backfillBatch = 500

// NewSupplierFigures is supplier_service as the operations tool needs it: the fold and nothing else. No team service —
// nothing here creates a supplier — and no broker — nothing here replays.
func NewSupplierFigures(db *gorm.DB) *supplier_v1.Service {
	return supplier_v1.NewService(db, nil, nil)
}

// supplierBackfillCommand is `san supplier backfill-figures` (past-accepts-are-backfilled-once).
func supplierBackfillCommand() *cli.Command {
	return &cli.Command{
		Name:      "backfill-figures",
		Usage:     "fold the restocks accepted before RestockAccepted existed into the supplier figures, once",
		ArgsUsage: " ",
		Description: "One-shot. Reads every accepted restock that names a supplier from inventory_service, builds the\n" +
			"RestockAccepted its accept would have sent, and folds it through supplier_service's own fold — the\n" +
			"same dedup, the same upsert. Skips every restock accepted at or after the live fold's first accept\n" +
			"(figures_live_since): the broker carried those. Run again, it folds nothing and says so.",
		Action: runSupplierBackfill,
	}
}

func runSupplierBackfill(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		result, err := san.BackfillSupplierFigures(ctx)
		if errors.Is(err, supplier_v1.ErrAlreadyBackfilled) {
			log.Printf("[%s] supplier figures: already backfilled — nothing folded", san.target)

			return nil
		}

		if err != nil {
			return err
		}

		log.Printf("[%s] supplier figures: %d accepted restocks folded, %d skipped (already folded, or the live fold's)",
			san.target, result.Folded, result.Skipped)

		return nil
	})
}

// BackfillSupplierFigures folds every accepted restock through supplier_service's fold, in batches, oldest first.
func (s *San) BackfillSupplierFigures(ctx context.Context) (supplier_v1.BackfillResult, error) {
	return s.suppliers.FoldBackfill(ctx, func(each func(*eventsv1.Event) error) error {
		var batch []inventory_service_models.RestockRequest

		return inventory_v1.AcceptedRestocks(s.db.WithContext(ctx)).
			FindInBatches(&batch, backfillBatch, func(_ *gorm.DB, _ int) error {
				for i := range batch {
					// The very event the accept builds — one function, so the backfill cannot fold a restock
					// differently from how it was accepted.
					err := each(inventory_v1.RestockAcceptedEvent(&batch[i]))
					if err != nil {
						return err
					}
				}

				return nil
			}).
			Error
	})
}

// backfillFiguresOn is the `dev setup` step — the same method the command runs, on setup's connection. A second run
// is the expected case there, so "already backfilled" is a line, not an error.
func backfillFiguresOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	san := &San{db: gdb, suppliers: NewSupplierFigures(gdb), target: target}

	result, err := san.BackfillSupplierFigures(ctx)
	if errors.Is(err, supplier_v1.ErrAlreadyBackfilled) {
		fmt.Println("  already backfilled")

		return nil
	}

	if err != nil {
		return err
	}

	fmt.Printf("  %d accepted restocks folded, %d skipped\n", result.Folded, result.Skipped)

	return nil
}
