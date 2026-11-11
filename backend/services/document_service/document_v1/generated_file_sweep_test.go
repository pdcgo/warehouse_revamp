package document_v1_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

const day = 24 * time.Hour

// storedFile writes a document row made `age` before now, with its object (and a thumbnail when thumb) in the store.
func storedFile(t *testing.T, db *gorm.DB, cfg docstore.Config, id, resourceType string, now time.Time, age time.Duration, thumb bool) document_service_models.Document {
	t.Helper()

	doc := document_service_models.Document{
		ID:           id,
		TeamID:       9,
		ResourceType: resourceType,
		ObjectKey:    "assets/teams/9/" + id + ".bin",
		SizeBytes:    1000,
		Filename:     id + ".bin",
		Status:       "active",
		CreatedAt:    now.Add(-age),
		UpdatedAt:    now.Add(-age),
	}

	if thumb {
		doc.ThumbnailKey = "assets/teams/9/" + id + "_thumb.jpg"
	}

	err := db.Create(&doc).Error
	if err != nil {
		t.Fatalf("insert %s: %v", id, err)
	}

	for _, key := range []string{doc.ObjectKey, doc.ThumbnailKey} {
		if key == "" {
			continue
		}

		path := filepath.Join(cfg.Dir, filepath.FromSlash(key))

		err = os.MkdirAll(filepath.Dir(path), 0o755)
		if err != nil {
			t.Fatalf("mkdir: %v", err)
		}

		err = os.WriteFile(path, []byte("generated"), 0o644)
		if err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}

	return doc
}

func sweep(t *testing.T, svc *document_v1.Service, in document_v1.GeneratedSweepInput) document_v1.GeneratedSweepResult {
	t.Helper()

	result, err := svc.SweepGeneratedFiles(context.Background(), in)
	if err != nil {
		t.Fatalf("SweepGeneratedFiles: %v", err)
	}

	return result
}

func assertGone(t *testing.T, db *gorm.DB, cfg docstore.Config, doc document_service_models.Document) {
	t.Helper()

	if rowExists(db, doc.ID) {
		t.Errorf("%s (%s): its row is still there", doc.ID, doc.ResourceType)
	}

	for _, key := range []string{doc.ObjectKey, doc.ThumbnailKey} {
		if key != "" && fileExists(cfg, key) {
			t.Errorf("%s (%s): %s is still stored", doc.ID, doc.ResourceType, key)
		}
	}
}

func assertKept(t *testing.T, db *gorm.DB, cfg docstore.Config, doc document_service_models.Document) {
	t.Helper()

	if !rowExists(db, doc.ID) {
		t.Errorf("%s (%s): its row was deleted", doc.ID, doc.ResourceType)
	}

	if !fileExists(cfg, doc.ObjectKey) {
		t.Errorf("%s (%s): its file was deleted", doc.ID, doc.ResourceType)
	}
}

// generated-files-are-kept-seven-days: a merged label PDF, a table export and an order export made more than seven
// days ago go — the stored object, its thumbnail, and the row.
func TestSweepGeneratedFiles_AnOldGeneratedFileIsSwept(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	old := []document_service_models.Document{
		storedFile(t, db, cfg, "sweep-labels", "order_labels", now, 8*day, false),
		storedFile(t, db, cfg, "sweep-table", "table_export", now, 30*day, true),
		storedFile(t, db, cfg, "sweep-orders", "order_export", now, 7*day+time.Minute, false),
	}

	result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now})

	if result.Swept != 3 || result.Bytes != 3000 || result.More {
		t.Fatalf("swept %+v, want 3 files, 3000 bytes, nothing more", result)
	}

	if want := now.Add(-7 * day); !result.Cutoff.Equal(want) {
		t.Fatalf("cutoff %v, want %v", result.Cutoff, want)
	}

	for _, doc := range old {
		assertGone(t, db, cfg, doc)
	}
}

// The merged label PDF the order service stores (StoreOrderLabels) is swept by its real key once it is a week old.
func TestSweepGeneratedFiles_AStoredLabelsPDFIsSweptAWeekLater(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	_, _, err := svc.StoreOrderLabels(context.Background(), 11, "labels.pdf", []byte("%PDF-1.4 labels"))
	if err != nil {
		t.Fatalf("StoreOrderLabels: %v", err)
	}

	var doc document_service_models.Document

	err = db.Where("resource_type = ?", "order_labels").First(&doc).Error
	if err != nil {
		t.Fatalf("the stored labels: %v", err)
	}

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: time.Now().Add(6 * day)}); result.Swept != 0 {
		t.Fatalf("six days on: swept %d, want 0", result.Swept)
	}

	assertKept(t, db, cfg, doc)

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: time.Now().Add(8 * day)}); result.Swept != 1 {
		t.Fatalf("eight days on: swept %d, want 1", result.Swept)
	}

	assertGone(t, db, cfg, doc)
}

// A generated file younger than seven days stays — exactly seven days old too: only an OLDER one goes.
func TestSweepGeneratedFiles_AFreshOneIsKept(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	fresh := []document_service_models.Document{
		storedFile(t, db, cfg, "fresh-today", "order_labels", now, 0, false),
		storedFile(t, db, cfg, "fresh-six-days", "table_export", now, 6*day, false),
		storedFile(t, db, cfg, "fresh-seven-days", "order_export", now, 7*day, false),
	}

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now}); result.Swept != 0 || result.More {
		t.Fatalf("swept %+v, want nothing", result)
	}

	for _, doc := range fresh {
		assertKept(t, db, cfg, doc)
	}
}

// generated-files-are-kept-seven-days: an UPLOADED file is never swept, however old — a label, a receipt, a
// statement, a proof of payment, a photo.
func TestSweepGeneratedFiles_AnUploadOfTheSameAgeIsKept(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	uploads := []string{"general", "profile_picture", "product_image", "order_receipt", "payment_proof", "settlement_statement"}

	kept := make([]document_service_models.Document, 0, len(uploads))
	for _, kind := range uploads {
		kept = append(kept, storedFile(t, db, cfg, "upload-"+kind, kind, now, 30*day, true))
	}

	generated := storedFile(t, db, cfg, "upload-beside-export", "table_export", now, 30*day, false)

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now}); result.Swept != 1 {
		t.Fatalf("swept %d, want only the export", result.Swept)
	}

	assertGone(t, db, cfg, generated)

	for _, doc := range kept {
		assertKept(t, db, cfg, doc)

		if !fileExists(cfg, doc.ThumbnailKey) {
			t.Errorf("%s: its thumbnail was deleted", doc.ResourceType)
		}
	}
}

// A generated file somebody SHARED is kept — never a document a person shared — and its share with it.
func TestSweepGeneratedFiles_ASharedGeneratedFileIsKept(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	shared := storedFile(t, db, cfg, "shared-export", "table_export", now, 20*day, false)
	alone := storedFile(t, db, cfg, "alone-export", "table_export", now, 20*day, false)

	err := db.Create(&document_service_models.DocumentShare{DocumentID: shared.ID, TeamID: 12, GrantedBy: 5}).Error
	if err != nil {
		t.Fatalf("share: %v", err)
	}

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now}); result.Swept != 1 || result.More {
		t.Fatalf("swept %+v, want the unshared one only", result)
	}

	assertKept(t, db, cfg, shared)
	assertGone(t, db, cfg, alone)
}

// The sweep is idempotent: a second run the same day finds nothing and touches nothing.
func TestSweepGeneratedFiles_ASecondRunIsANoOp(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	storedFile(t, db, cfg, "twice-old", "order_labels", now, 9*day, false)
	fresh := storedFile(t, db, cfg, "twice-fresh", "order_labels", now, day, false)
	upload := storedFile(t, db, cfg, "twice-upload", "order_receipt", now, 9*day, false)

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now}); result.Swept != 1 {
		t.Fatalf("first run swept %d, want 1", result.Swept)
	}

	ctid := func(id string) string {
		var v string

		db.Raw(`SELECT ctid::text FROM documents WHERE id = ?`, id).Scan(&v)

		return v
	}

	before := []string{ctid(fresh.ID), ctid(upload.ID)}

	second := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now})
	if second.Swept != 0 || second.Bytes != 0 || second.More {
		t.Fatalf("second run %+v, want nothing", second)
	}

	if after := []string{ctid(fresh.ID), ctid(upload.ID)}; after[0] != before[0] || after[1] != before[1] {
		t.Fatalf("the second run rewrote a kept row: %v → %v", before, after)
	}

	assertKept(t, db, cfg, fresh)
	assertKept(t, db, cfg, upload)
}

// A run is BOUNDED: it stops at its limit, oldest first, says more are left, and the next runs take the rest.
func TestSweepGeneratedFiles_ARunStopsAtItsLimit(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	docs := make([]document_service_models.Document, 0, 5)
	for i := range 5 {
		docs = append(docs, storedFile(t, db, cfg, fmt.Sprintf("bounded-%d", i), "table_export", now, time.Duration(20-i)*day, false))
	}

	first := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now, Limit: 2})
	if first.Swept != 2 || !first.More {
		t.Fatalf("first run %+v, want 2 swept and more left", first)
	}

	// Oldest first: 0 and 1 are the oldest.
	assertGone(t, db, cfg, docs[0])
	assertGone(t, db, cfg, docs[1])
	assertKept(t, db, cfg, docs[2])

	if second := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now, Limit: 2}); second.Swept != 2 || !second.More {
		t.Fatalf("second run %+v, want 2 swept and more left", second)
	}

	if third := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now, Limit: 2}); third.Swept != 1 || third.More {
		t.Fatalf("third run %+v, want the last one and nothing more", third)
	}
}

// More than one transaction's worth (100) in one run: every one goes, and the run ends saying nothing is left.
func TestSweepGeneratedFiles_ARunSpansSeveralBatches(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	for i := range 130 {
		storedFile(t, db, cfg, fmt.Sprintf("batch-%03d", i), "order_export", now, 10*day+time.Duration(i)*time.Minute, false)
	}

	result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now})
	if result.Swept != 130 || result.Bytes != 130_000 || result.More {
		t.Fatalf("swept %+v, want all 130", result)
	}

	var left int64

	db.Model(&document_service_models.Document{}).Where("id LIKE 'batch-%'").Count(&left)

	if left != 0 {
		t.Fatalf("%d rows left", left)
	}
}

// A dry run says what a run would delete — the same oldest-first, bounded set — and deletes nothing.
func TestSweepGeneratedFiles_ADryRunDeletesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	docs := []document_service_models.Document{
		storedFile(t, db, cfg, "dry-1", "order_labels", now, 10*day, false),
		storedFile(t, db, cfg, "dry-2", "table_export", now, 9*day, false),
		storedFile(t, db, cfg, "dry-3", "order_export", now, 8*day, false),
		storedFile(t, db, cfg, "dry-fresh", "order_export", now, day, false),
	}

	all := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now, DryRun: true})
	if all.Swept != 3 || all.Bytes != 3000 || all.More {
		t.Fatalf("dry run %+v, want 3 files, 3000 bytes", all)
	}

	bounded := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now, DryRun: true, Limit: 2})
	if bounded.Swept != 2 || !bounded.More {
		t.Fatalf("bounded dry run %+v, want 2 and more left", bounded)
	}

	for _, doc := range docs {
		assertKept(t, db, cfg, doc)
	}
}

// An object already gone (a run that deleted it and then failed to commit) still lets its row go: the store ignores a
// missing key, so the next run finishes what the last one started.
func TestSweepGeneratedFiles_AFileAlreadyGoneStillTakesItsRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	now := time.Now()

	doc := storedFile(t, db, cfg, "half-swept", "order_labels", now, 10*day, false)

	err := os.Remove(filepath.Join(cfg.Dir, filepath.FromSlash(doc.ObjectKey)))
	if err != nil {
		t.Fatal(err)
	}

	if result := sweep(t, svc, document_v1.GeneratedSweepInput{Now: now}); result.Swept != 1 {
		t.Fatalf("swept %d, want 1", result.Swept)
	}

	assertGone(t, db, cfg, doc)
}

// The daily ticker: nothing before `first`, then a run each `every` after the last one ended, and it stops when the
// server does.
func TestSweepGeneratedFilesEvery_RunsOnItsTicksAndStops(t *testing.T) {
	var runs atomic.Int32

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		document_v1.RunEvery(ctx, 20*time.Millisecond, 10*time.Millisecond, func(context.Context) {
			if runs.Add(1) == 3 {
				cancel()
			}
		})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the ticker did not stop after its context ended")
	}

	if got := runs.Load(); got != 3 {
		t.Fatalf("%d runs, want 3", got)
	}

	// Before its first tick, it runs nothing.
	var early atomic.Int32

	ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	document_v1.RunEvery(ctx, time.Hour, time.Hour, func(context.Context) { early.Add(1) })

	if early.Load() != 0 {
		t.Fatal("ran before its first tick")
	}
}
