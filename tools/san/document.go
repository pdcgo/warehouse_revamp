package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/urfave/cli/v3"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// NewDocuments is document_service as the operations tool needs it: the generated-file sweep. The store is the
// server's — the same DOCUMENT_STORAGE_DIR (empty = the same temp-dir default) — so the sweep deletes the objects the
// server stored. No signer secret or file endpoint: the sweep signs no link.
func NewDocuments(db *gorm.DB, cfg *Config) *document_v1.Service {
	return document_v1.NewService(db, docstore.Config{Dir: cfg.DocumentStorageDir})
}

// documentCommand is document_service's operator actions: today, running the daily sweep of generated downloads by
// hand (generated-files-are-kept-seven-days).
func documentCommand() *cli.Command {
	return &cli.Command{
		Name:  "document",
		Usage: "stored files",
		Commands: []*cli.Command{
			{
				Name:      "sweep-generated",
				Usage:     "delete generated downloads older than 7 days — merged label PDFs, table exports, order exports — now, as the server's daily sweep does",
				ArgsUsage: " ",
				Description: "generated-files-are-kept-seven-days: a file the system MADE for a download is kept 7 days from when it was\n" +
					"made. This runs the server's daily sweep once: oldest first, at most --limit files, each one's stored object\n" +
					"(and thumbnail) and its documents row. An uploaded file — a label, a receipt, a statement, a proof of payment —\n" +
					"and a generated file somebody shared are never touched. Idempotent: run it again and it finds nothing.\n" +
					"--dry-run counts what it would delete and deletes nothing. Point DOCUMENT_STORAGE_DIR at the server's store.",
				Flags: []cli.Flag{
					&cli.BoolFlag{Name: "dry-run", Usage: "count what would be deleted, delete nothing"},
					&cli.IntFlag{Name: "limit", Value: document_v1.GeneratedSweepLimit, Usage: "the most files this run deletes (oldest first)"},
				},
				Action: runDocumentSweep,
			},
		},
	}
}

var errSweepLimit = errors.New("--limit must be at least 1")

func runDocumentSweep(ctx context.Context, cmd *cli.Command) error {
	in := document_v1.GeneratedSweepInput{DryRun: cmd.Bool("dry-run"), Limit: int(cmd.Int("limit"))}
	if in.Limit < 1 {
		return errSweepLimit
	}

	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		result, err := san.DocumentSweep(ctx, in)
		if errors.Is(err, document_v1.ErrSweepRunning) {
			return fmt.Errorf("[%s] %w", san.target, err)
		}

		if err != nil {
			return err
		}

		printSweep(os.Stdout, san.target, in, result)

		return nil
	})
}

// DocumentSweep runs the generated-file sweep through document_service's own method — its lock, its predicate, its store.
func (s *San) DocumentSweep(ctx context.Context, in document_v1.GeneratedSweepInput) (document_v1.GeneratedSweepResult, error) {
	return s.documents.SweepGeneratedFiles(ctx, in)
}

// printSweep writes one line of what the run did, and a second when it stopped at its limit.
func printSweep(w io.Writer, target string, in document_v1.GeneratedSweepInput, result document_v1.GeneratedSweepResult) {
	verb := "swept"
	if in.DryRun {
		verb = "DRY RUN — would sweep"
	}

	_, _ = fmt.Fprintf(w, "[%s] %s %d generated file(s), %.1f MB, made before %s\n",
		target, verb, result.Swept, float64(result.Bytes)/(1<<20), result.Cutoff.Format("2006-01-02 15:04 MST"))

	if result.More {
		_, _ = fmt.Fprintf(w, "[%s] stopped at --limit %d: older generated files are left — run it again\n", target, in.Limit)
	}
}
