package document_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm"
)

// GeneratedFileKeep is how long a file the system MADE for a download is kept (generated-files-are-kept-seven-days):
// a merged label PDF, a table export, an order export. Its link expired long before; whoever needs it again makes it
// again — the data behind it never goes away.
const GeneratedFileKeep = 7 * 24 * time.Hour

// GeneratedSweepLimit is the most files ONE run deletes unless told otherwise — the sweep is bounded per run, and a
// run that hits it says so (More) and leaves the rest to the next one.
const GeneratedSweepLimit = 1000

// generatedSweepBatch is how many files one transaction deletes: its row locks are held while their objects are
// deleted, so it stays small.
const generatedSweepBatch = 100

// ErrSweepRunning is the sweep's answer while another sweep (another instance's daily run, or `san document
// sweep-generated`) holds its lock: this one stops without deleting anything — the other one is doing the work.
var ErrSweepRunning = errors.New("another generated-file sweep is running — this one stopped, the other one is doing the work")

// GeneratedSweepInput is one run of the sweep.
type GeneratedSweepInput struct {
	// Now is the clock the 7 days are counted back from; zero is the current time.
	Now time.Time
	// Limit is the most files this run deletes; 0 is GeneratedSweepLimit.
	Limit int
	// DryRun counts what would be deleted and deletes nothing.
	DryRun bool
}

// GeneratedSweepResult is what one run did.
type GeneratedSweepResult struct {
	// Cutoff: a generated file made before it is swept.
	Cutoff time.Time
	// Swept is how many files were deleted — or, on a dry run, would be (at most Limit).
	Swept int
	// Bytes is their stored size.
	Bytes int64
	// More: the run stopped at its limit with older generated files still left — the next run takes them.
	More bool
}

// generatedResourceTypes are the files the system MAKES for a download — never one a person uploaded: a label, a
// receipt, a statement, a proof of payment and a document somebody shared are never swept. Written into the SQL as
// literals, not bound: the partial index documents_generated_created_idx (document 00012) carries the same list, and
// the planner matches a partial index only against constants it can see.
const generatedResourceTypes = `resource_type IN ('` + resourceOrderLabels + `', '` + resourceTableExport + `', '` +
	resourceOrderExport + `')`

// eligible is the sweep's one predicate: a generated download made before the cutoff that nobody has shared. A shared
// one is kept (generated-files-are-kept-seven-days: never a document a person shared), and its share row would refuse
// the delete anyway (document_shares ON DELETE RESTRICT).
const eligible = generatedResourceTypes + ` AND created_at < ?
	AND NOT EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = documents.id)`

// The sweep's three statements, in the order one batch runs them.
const (
	// sweepLockSQL: ONE sweep at a time, across instances — held to the end of the batch's transaction.
	sweepLockSQL = `SELECT pg_try_advisory_xact_lock(hashtext('document_service'), hashtext('generated-file-sweep'))`

	// sweepPickSQL takes the oldest eligible rows and LOCKS them. SKIP LOCKED: a row another transaction holds — a
	// share being written for it (its foreign key check locks the row) — is left for the next run, never waited on.
	sweepPickSQL = `SELECT id FROM documents WHERE ` + eligible + `
		ORDER BY created_at, id
		LIMIT ?
		FOR UPDATE SKIP LOCKED`

	// sweepDeleteSQL deletes the picked rows, checking for a share AGAIN under this statement's own snapshot: a share
	// committed after the pick's snapshot but before its lock keeps its file. No share can land on these rows now —
	// they are locked.
	sweepDeleteSQL = `DELETE FROM documents d
		WHERE d.id IN ?
		  AND NOT EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = d.id)
		RETURNING d.id, d.object_key, d.thumbnail_key, d.size_bytes`
)

// SweepGeneratedFiles deletes every generated download older than seven days — its stored object, its thumbnail if
// any, and its `documents` row (generated-files-are-kept-seven-days). A Go method, NOT an RPC: the daily ticker in the
// server (SweepGeneratedFilesEvery) and `san document sweep-generated` call it; no browser can.
//
// Idempotent and bounded: oldest first, at most Limit files, in transactions of generatedSweepBatch. Each transaction
// first takes the sweep's advisory lock (two instances never sweep at once — the second stops with ErrSweepRunning),
// locks its rows FOR UPDATE SKIP LOCKED, deletes them — re-checking for a share under a fresh snapshot, now that no
// new share can land on a locked row — then deletes their objects, then commits. An object that fails to delete rolls
// its rows back, so the next run tries again; an object already gone is not an error (the store ignores a missing
// key). A download racing the sweep either reads the row first and gets a link to a file about to go, or reads
// NotFound — both what an expired download answers.
func (s *Service) SweepGeneratedFiles(ctx context.Context, in GeneratedSweepInput) (GeneratedSweepResult, error) {
	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}

	limit := in.Limit
	if limit <= 0 {
		limit = GeneratedSweepLimit
	}

	result := GeneratedSweepResult{Cutoff: now.Add(-GeneratedFileKeep)}

	if in.DryRun {
		return s.countGenerated(ctx, result, limit)
	}

	for result.Swept < limit {
		size := min(generatedSweepBatch, limit-result.Swept)

		n, bytes, err := s.sweepBatch(ctx, result.Cutoff, size)
		if errors.Is(err, ErrSweepRunning) && result.Swept > 0 {
			// Another sweep took the lock between two of this run's batches: it carries on from here.
			result.More = true

			return result, nil
		}

		if err != nil {
			return result, err
		}

		result.Swept += n
		result.Bytes += bytes

		if n < size {
			return result, nil
		}
	}

	// The run stopped at its limit: say whether anything is left for the next one.
	err := s.db.
		WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM documents WHERE `+eligible+`)`, result.Cutoff).
		Scan(&result.More).
		Error
	if err != nil {
		return result, err
	}

	return result, nil
}

// countGenerated is the dry run: how many files a run would delete, and their size.
func (s *Service) countGenerated(ctx context.Context, result GeneratedSweepResult, limit int) (GeneratedSweepResult, error) {
	var oldest []struct {
		SizeBytes int64
	}

	// One more than the limit, oldest first — exactly the rows a run would take, and whether any are left after it.
	err := s.db.
		WithContext(ctx).
		Table("documents").
		Select("size_bytes").
		Where(eligible, result.Cutoff).
		Order("created_at, id").
		Limit(limit + 1).
		Scan(&oldest).
		Error
	if err != nil {
		return result, err
	}

	for i, row := range oldest {
		if i == limit {
			result.More = true

			break
		}

		result.Swept++
		result.Bytes += row.SizeBytes
	}

	return result, nil
}

// swept is one row the batch deleted.
type swept struct {
	ID           string
	ObjectKey    string
	ThumbnailKey string
	SizeBytes    int64
}

// sweepBatch deletes up to size generated files older than the cutoff in ONE transaction, under the sweep's lock.
func (s *Service) sweepBatch(ctx context.Context, cutoff time.Time, size int) (int, int64, error) {
	var gone []swept

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked bool

		err := tx.
			Raw(sweepLockSQL).
			Scan(&locked).
			Error
		if err != nil {
			return err
		}

		if !locked {
			return ErrSweepRunning
		}

		var ids []string

		err = tx.
			Raw(sweepPickSQL, cutoff, size).
			Scan(&ids).
			Error
		if err != nil {
			return err
		}

		if len(ids) == 0 {
			return nil
		}

		err = tx.
			Raw(sweepDeleteSQL, ids).
			Scan(&gone).
			Error
		if err != nil {
			return err
		}

		// The objects inside the transaction: one that fails rolls the rows back, so the next run finds it again.
		for _, doc := range gone {
			for _, key := range []string{doc.ObjectKey, doc.ThumbnailKey} {
				if key == "" {
					continue
				}

				err = s.store.Delete(key)
				if err != nil {
					return fmt.Errorf("deleting generated file %s: %w", doc.ID, err)
				}
			}
		}

		return nil
	})
	if err != nil {
		return 0, 0, err
	}

	var bytes int64

	for _, doc := range gone {
		bytes += doc.SizeBytes
	}

	return len(gone), bytes, nil
}

// SweepGeneratedFilesEvery is the DAILY sweep (generated-files-are-kept-seven-days): it runs the sweep once after
// `first`, then every `every`, until ctx ends — in the server's own process, since nothing else schedules a job
// (there is no cron). Two instances each run it; the sweep's lock keeps them from sweeping at once, and a second run
// the same day finds nothing to do. A failed run is logged and tried again at the next tick.
func (s *Service) SweepGeneratedFilesEvery(ctx context.Context, first, every time.Duration) {
	runEvery(ctx, first, every, s.sweepAndLog)
}

// sweepAndLog is one scheduled run: the sweep with its defaults, and a log line of what it did.
func (s *Service) sweepAndLog(ctx context.Context) {
	result, err := s.SweepGeneratedFiles(ctx, GeneratedSweepInput{})

	switch {
	case errors.Is(err, ErrSweepRunning):
		slog.Info("generated-file sweep: another instance is sweeping")
	case err != nil && ctx.Err() == nil:
		slog.Warn("generated-file sweep failed", slog.String("err", err.Error()), slog.Int("swept", result.Swept))
	case err == nil:
		slog.Info("generated-file sweep",
			slog.Int("swept", result.Swept),
			slog.Int64("bytes", result.Bytes),
			slog.Bool("more", result.More),
			slog.Time("cutoff", result.Cutoff))
	}
}

// runEvery calls run once after first, then every `every` after the previous run ENDED (a slow run never overlaps the
// next), until ctx ends.
func runEvery(ctx context.Context, first, every time.Duration, run func(context.Context)) {
	timer := time.NewTimer(first)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		run(ctx)

		timer.Reset(every)
	}
}
