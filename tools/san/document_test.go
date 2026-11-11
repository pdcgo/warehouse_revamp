package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// `san document sweep-generated` (generated-files-are-kept-seven-days): a dry run counts the old generated export and
// deletes nothing; the real run deletes its object and row and keeps a fresh one and an upload of the same age; a
// second run finds nothing.
func TestDocumentSweep_SweepsTheOldGeneratedFilesByHand(t *testing.T) {
	db := san_testdb.DB(t)
	dir := t.TempDir()
	san := &San{db: db, documents: NewDocuments(db, &Config{DocumentStorageDir: dir}), target: "test"}
	ctx := context.Background()
	now := time.Now()

	put := func(id, kind string, age time.Duration) string {
		key := "assets/teams/9/" + id + ".bin"

		err := db.Create(&document_service_models.Document{
			ID: id, TeamID: 9, ResourceType: kind, ObjectKey: key, SizeBytes: 3 << 20, Status: "active",
			CreatedAt: now.Add(-age), UpdatedAt: now.Add(-age),
		}).Error
		if err != nil {
			t.Fatal(err)
		}

		path := filepath.Join(dir, filepath.FromSlash(key))

		err = os.MkdirAll(filepath.Dir(path), 0o755)
		if err != nil {
			t.Fatal(err)
		}

		err = os.WriteFile(path, []byte("x"), 0o644)
		if err != nil {
			t.Fatal(err)
		}

		return path
	}

	old := put("san-sweep-old", "table_export", 10*24*time.Hour)
	fresh := put("san-sweep-fresh", "table_export", 24*time.Hour)
	upload := put("san-sweep-upload", "order_receipt", 10*24*time.Hour)

	in := document_v1.GeneratedSweepInput{Now: now, Limit: document_v1.GeneratedSweepLimit, DryRun: true}

	dry, err := san.DocumentSweep(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer

	printSweep(&out, san.target, in, dry)

	if dry.Swept != 1 || !strings.Contains(out.String(), "DRY RUN — would sweep 1 generated file(s), 3.0 MB") {
		t.Fatalf("dry run %+v:\n%s", dry, out.String())
	}

	_, err = os.Stat(old)
	if err != nil {
		t.Fatal("the dry run deleted the file")
	}

	in.DryRun = false

	done, err := san.DocumentSweep(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out.Reset()
	printSweep(&out, san.target, in, done)

	if done.Swept != 1 || !strings.Contains(out.String(), "[test] swept 1 generated file(s), 3.0 MB") {
		t.Fatalf("real run %+v:\n%s", done, out.String())
	}

	_, err = os.Stat(old)
	if !os.IsNotExist(err) {
		t.Fatal("the old export's file is still stored")
	}

	for _, kept := range []string{fresh, upload} {
		_, err = os.Stat(kept)
		if err != nil {
			t.Fatalf("%s was deleted", kept)
		}
	}

	again, err := san.DocumentSweep(ctx, in)
	if err != nil || again.Swept != 0 {
		t.Fatalf("a second run swept %d (%v), want nothing", again.Swept, err)
	}
}

// A run that stops at its limit says so, and names the way on.
func TestDocumentSweep_SaysWhenItStoppedAtItsLimit(t *testing.T) {
	var out bytes.Buffer

	printSweep(&out, "Database Local", document_v1.GeneratedSweepInput{Limit: 2},
		document_v1.GeneratedSweepResult{Swept: 2, Bytes: 1 << 20, More: true, Cutoff: time.Now()})

	if !strings.Contains(out.String(), "stopped at --limit 2: older generated files are left — run it again") {
		t.Fatalf("output:\n%s", out.String())
	}
}
