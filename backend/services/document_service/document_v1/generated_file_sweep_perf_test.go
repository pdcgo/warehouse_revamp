//go:build perfaudit

package document_v1_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// generatedCreatedIndex is document 00012's index, re-created here for the "after" half of the probe.
const generatedCreatedIndex = `CREATE INDEX documents_generated_created_idx ON documents (created_at, id)
	WHERE resource_type IN ('order_labels', 'table_export', 'order_export')`

var errUndo = errors.New("undo the run")

// The performance audit of the generated-file sweep (audit-rpc-performance; generated-files-are-kept-seven-days). The
// steady state of a daily sweep: `documents` holds a YEAR of uploads that are never swept — 300 000 receipts, statements,
// proofs and photos — beside only the last eight days of generated downloads (2 000 a day, 16 000), of which the
// oldest day's 2 000 are past the cutoff; 5 000 proofs are shared. One run, measured with the index absent and present,
// each in a savepoint that is rolled back so both runs sweep the same rows.
func TestPerf_SweepGeneratedFiles(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	now := time.Now()

	uploads := []string{"order_receipt", "general", "payment_proof", "product_image", "settlement_statement"}
	generated := []string{"order_labels", "table_export", "order_export"}

	docs := make([]document_service_models.Document, 0, 316_000)

	for i := range 300_000 {
		at := now.Add(-time.Duration(i%365)*24*time.Hour - time.Duration(i%1440)*time.Minute)
		docs = append(docs, document_service_models.Document{
			ID: fmt.Sprintf("up-%d", i), TeamID: uint64(i % 300), ResourceType: uploads[i%len(uploads)],
			ObjectKey: fmt.Sprintf("perf/up-%d", i), SizeBytes: 50_000, Status: "active", CreatedAt: at, UpdatedAt: at,
		})
	}

	for i := range 16_000 {
		at := now.Add(-time.Duration(i) * (8 * 24 * time.Hour / 16_000))
		docs = append(docs, document_service_models.Document{
			ID: fmt.Sprintf("gen-%d", i), TeamID: uint64(i % 300), ResourceType: generated[i%len(generated)],
			ObjectKey: fmt.Sprintf("perf/gen-%d", i), SizeBytes: 200_000, Status: "active", CreatedAt: at, UpdatedAt: at,
		})
	}

	san_perf.SeedRows(t, db, &docs)

	shares := make([]document_service_models.DocumentShare, 0, 5_000)
	for i := range 5_000 {
		shares = append(shares, document_service_models.DocumentShare{DocumentID: fmt.Sprintf("up-%d", i*5+2), TeamID: 12, GrantedBy: 1})
	}

	san_perf.SeedRows(t, db, &shares)

	_, cfg := newService(t, db)
	cutoff := now.Add(-document_v1.GeneratedFileKeep)

	pick := strings.Replace(document_v1.SweepPickSQL, "?", "'"+cutoff.Format(time.RFC3339Nano)+"'", 1)
	pick = strings.Replace(pick, "?", "100", 1)

	measure := func(label string) {
		t.Logf("──── %s", label)

		san_perf.Explain(t, db, pick)

		for _, dry := range []bool{true, false} {
			probe.Reset()

			var result document_v1.GeneratedSweepResult

			wall, dbTime := probe.Measure(func() {
				_ = db.Transaction(func(tx *gorm.DB) error {
					var err error

					result, err = document_v1.NewService(tx, cfg).SweepGeneratedFiles(context.Background(), document_v1.GeneratedSweepInput{Now: now, DryRun: dry, Limit: 5_000})
					if err != nil {
						t.Fatalf("sweep: %v", err)
					}

					return errUndo
				})
			})

			t.Logf("%s dry=%v: swept %d (%d MB), more=%v — wall=%v db=%v queries=%d",
				label, dry, result.Swept, result.Bytes>>20, result.More, wall, dbTime, probe.Count())
		}

		probe.Report(t, "SweepGeneratedFiles "+label)
	}

	err := db.Exec(`DROP INDEX IF EXISTS documents_generated_created_idx`).Error
	if err != nil {
		t.Fatal(err)
	}

	measure("BEFORE (no index)")

	err = db.Exec(generatedCreatedIndex).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`ANALYZE documents`).Error
	if err != nil {
		t.Fatal(err)
	}

	measure("AFTER (documents_generated_created_idx)")
}
