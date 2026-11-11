//go:build raceaudit

package document_v1_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// The concurrency audit of the generated-file sweep (audit-sql, generated-files-are-kept-seven-days). The sweep is no
// RPC, but it deletes rows a download and a share read: it locks its rows FOR UPDATE SKIP LOCKED under an advisory
// lock, re-checks for a share in its delete, deletes the objects inside its transaction, then commits.

func sweepPrefix(t *testing.T, db *gorm.DB) string {
	t.Helper()

	prefix := fmt.Sprintf("sweeprace-%d-", time.Now().UnixNano()%1_000_000_000)

	t.Cleanup(func() {
		db.Where("document_id LIKE ?", prefix+"%").Delete(&document_service_models.DocumentShare{})
		db.Where("id LIKE ?", prefix+"%").Delete(&document_service_models.Document{})
	})

	return prefix
}

func sweepOK(err error) bool {
	return err == nil || errors.Is(err, document_v1.ErrSweepRunning)
}

// Two instances' daily runs (and an operator's `san document sweep-generated`) at the same second: every caller ends
// cleanly — swept, or stopped by the lock — and every old file is gone exactly once.
func TestRace_SweepGeneratedFiles_FourSweepsAtOnce(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc, cfg := newService(t, db)
	prefix := sweepPrefix(t, db)
	now := time.Now()

	stopped, survived := 0, 0

	for round := range 10 {
		var docs []document_service_models.Document
		for i := range 5 {
			docs = append(docs, storedFile(t, db, cfg, fmt.Sprintf("%s%d-%d", prefix, round, i), "order_labels", now, 30*day, i == 0))
		}

		res := h.Race(t, 4, func(int) error {
			_, err := svc.SweepGeneratedFiles(context.Background(), document_v1.GeneratedSweepInput{Now: now})
			if errors.Is(err, document_v1.ErrSweepRunning) {
				return nil
			}

			return err
		})
		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: a sweep failed", round)
		}

		// A caller stopped by the lock may leave files for the next run — the last caller standing sweeps again.
		_, err := svc.SweepGeneratedFiles(context.Background(), document_v1.GeneratedSweepInput{Now: now})
		if !sweepOK(err) {
			t.Fatal(err)
		}

		for _, doc := range docs {
			if rowExists(db, doc.ID) || fileExists(cfg, doc.ObjectKey) || (doc.ThumbnailKey != "" && fileExists(cfg, doc.ThumbnailKey)) {
				survived++
			}
		}

		stopped += res.Count(san_race.None) - 1 // the callers beyond the one that swept: stopped by the lock or found nothing
	}

	if survived > 0 {
		t.Fatalf("%d old files survived the sweeps", survived)
	}

	t.Logf("10 rounds × 4 sweeps at once: every caller ended cleanly (%d beside the one that swept), nothing survived", stopped)
}

// A download racing the sweep (generated-files-are-kept-seven-days: its link expires on its own before that): the
// download either reads the row first and gets a link — to a file about to go — or reads NotFound. Never an internal
// error, never a half-deleted row, and the sweep never fails.
func TestRace_SweepGeneratedFiles_ADownloadRacingTheSweep(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc, cfg := newService(t, db)
	prefix := sweepPrefix(t, db)
	now := time.Now()

	links, notFound := 0, 0

	for round := range 30 {
		doc := storedFile(t, db, cfg, fmt.Sprintf("%sdl-%d", prefix, round), "table_export", now, 8*day, false)

		outcomes := make([]error, 4)

		h.Race(t, 4, func(i int) error {
			// Both orderings: the download waits on even rounds, the sweep on odd ones.
			if i%2 == round%2 {
				time.Sleep(time.Duration(round%5) * time.Millisecond)
			}

			if i%2 == 0 {
				_, err := svc.GetDownloadUrl(context.Background(), connect.NewRequest(&documentv1.GetDownloadUrlRequest{
					TeamId: doc.TeamID, DocumentId: doc.ID,
				}))
				outcomes[i] = err

				return nil
			}

			_, err := svc.SweepGeneratedFiles(context.Background(), document_v1.GeneratedSweepInput{Now: now})
			if !sweepOK(err) {
				return err
			}

			return nil
		})

		for i, err := range outcomes {
			if i%2 != 0 {
				continue
			}

			switch connect.CodeOf(err) {
			case connect.CodeNotFound:
				notFound++
			default:
				if err != nil {
					t.Fatalf("round %d: a download racing the sweep: %v — want a link or NotFound", round, err)
				}

				links++
			}
		}

		if rowExists(db, doc.ID) || fileExists(cfg, doc.ObjectKey) {
			t.Fatalf("round %d: the old export survived the sweep", round)
		}
	}

	t.Logf("downloads: %d read the row first (a link to a file about to go), %d read NotFound", links, notFound)
}

// A share racing the sweep (never a document a person shared): the share either lands first — the file, its row and
// the share all stay — or it fails because the sweep took the file. Never a share pointing at a deleted file, and the
// sweep never fails on the share's foreign key.
func TestRace_SweepGeneratedFiles_AShareRacingTheSweep(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc, cfg := newService(t, db)
	prefix := sweepPrefix(t, db)
	now := time.Now()

	kept, swept := 0, 0
	codes := map[connect.Code]int{}

	for round := range 40 {
		doc := storedFile(t, db, cfg, fmt.Sprintf("%ssh-%d", prefix, round), "table_export", now, 8*day, false)

		var shareErr error

		res := h.Race(t, 2, func(i int) error {
			// Both orderings: the share waits on even rounds, the sweep on odd ones.
			if i == round%2 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			if i == 0 {
				_, shareErr = svc.ShareDocument(context.Background(), connect.NewRequest(&documentv1.ShareDocumentRequest{
					TeamId: doc.TeamID, DocumentId: doc.ID, WithTeamId: 12,
				}))

				return nil
			}

			_, err := svc.SweepGeneratedFiles(context.Background(), document_v1.GeneratedSweepInput{Now: now})
			if !sweepOK(err) {
				return err
			}

			return nil
		})
		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: the sweep failed beside a share", round)
		}

		var shares int64

		db.Model(&document_service_models.DocumentShare{}).Where("document_id = ?", doc.ID).Count(&shares)

		row, file := rowExists(db, doc.ID), fileExists(cfg, doc.ObjectKey)

		switch {
		case shareErr == nil:
			if !row || !file || shares != 1 {
				t.Fatalf("round %d: the share landed but row=%v file=%v shares=%d", round, row, file, shares)
			}

			kept++
		default:
			if row || file || shares != 0 {
				t.Fatalf("round %d: the share failed (%v) but row=%v file=%v shares=%d", round, shareErr, row, file, shares)
			}

			codes[connect.CodeOf(shareErr)]++
			swept++
		}

		// The next round's sweep must not take this round's shared file.
		db.Where("document_id = ?", doc.ID).Delete(&document_service_models.DocumentShare{})
		db.Where("id = ?", doc.ID).Delete(&document_service_models.Document{})
	}

	t.Logf("shares: %d landed first (the file kept), %d lost to the sweep %v", kept, swept, codes)
}

// THE WRITTEN-DOWN SCHEDULE of a share in flight when the sweep picks: the share's foreign-key check holds the
// document row, so the pick SKIPS it rather than waiting, and the file stays for the share.
func TestInterleave_SweepGeneratedFiles_AShareInFlightIsSkipped(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	_, cfg := newService(t, db)
	prefix := sweepPrefix(t, db)
	now := time.Now()

	doc := storedFile(t, db, cfg, prefix+"inflight", "order_export", now, 9*day, false)

	var picked []string

	s := h.Interleave(t,
		san_race.Do("B", "share: insert (its FK check locks the document row)", func(tx *gorm.DB) error {
			return tx.Create(&document_service_models.DocumentShare{DocumentID: doc.ID, TeamID: 12, GrantedBy: 5}).Error
		}),
		san_race.Do("A", "sweep: advisory lock", func(tx *gorm.DB) error {
			return tx.Exec(document_v1.SweepLockSQL).Error
		}),
		san_race.Do("A", "sweep: pick FOR UPDATE SKIP LOCKED", func(tx *gorm.DB) error {
			return tx.Raw(document_v1.SweepPickSQL, now.Add(-document_v1.GeneratedFileKeep), 100).
				Scan(&picked).Error
		}),
		san_race.Commit("B"),
		san_race.Commit("A"),
	)
	s.Report(t)

	if s.Get("sweep: pick FOR UPDATE SKIP LOCKED").Blocked {
		t.Fatal("the pick WAITED on the share — it must skip a locked row")
	}

	for _, id := range picked {
		if id == doc.ID {
			t.Fatal("the pick took a document a share was being written for")
		}
	}

	if !rowExists(db, doc.ID) {
		t.Fatal("the shared file's row is gone")
	}
}

// THE WRITTEN-DOWN SCHEDULE of a share that comes AFTER the pick: the sweep holds the row, so the share's foreign-key
// check WAITS for it, and once the sweep commits the share is refused (the document is gone) — never a share row left
// pointing at a deleted file.
func TestInterleave_SweepGeneratedFiles_AShareAfterThePickWaitsAndIsRefused(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	_, cfg := newService(t, db)
	prefix := sweepPrefix(t, db)
	now := time.Now()

	doc := storedFile(t, db, cfg, prefix+"after", "order_export", now, 9*day, false)

	var picked []string

	var gone []struct{ ID string }

	s := h.Interleave(t,
		san_race.Do("A", "sweep: advisory lock", func(tx *gorm.DB) error {
			return tx.Exec(document_v1.SweepLockSQL).Error
		}),
		san_race.Do("A", "sweep: pick FOR UPDATE SKIP LOCKED", func(tx *gorm.DB) error {
			return tx.Raw(document_v1.SweepPickSQL, now.Add(-document_v1.GeneratedFileKeep), 100).
				Scan(&picked).Error
		}),
		san_race.Block("B", "share: insert (waits on the swept row)", func(tx *gorm.DB) error {
			return tx.Create(&document_service_models.DocumentShare{DocumentID: doc.ID, TeamID: 12, GrantedBy: 5}).Error
		}),
		san_race.Do("A", "sweep: delete, re-checking shares", func(tx *gorm.DB) error {
			return tx.Raw(document_v1.SweepDeleteSQL, []string{doc.ID}).Scan(&gone).Error
		}),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	s.Report(t)

	share := s.Get("share: insert (waits on the swept row)")
	if !share.Blocked {
		t.Fatal("the share did not wait for the sweep's row lock")
	}

	if share.Kind != san_race.ForeignKey {
		t.Fatalf("the share after the sweep ended %q (%v), want an fk violation", share.Kind, share.Err)
	}

	if len(gone) != 1 || rowExists(db, doc.ID) {
		t.Fatalf("the sweep deleted %d rows, want the picked one", len(gone))
	}

	var shares int64

	db.Model(&document_service_models.DocumentShare{}).Where("document_id = ?", doc.ID).Count(&shares)

	if shares != 0 {
		t.Fatal("a share row points at a swept file")
	}
}
