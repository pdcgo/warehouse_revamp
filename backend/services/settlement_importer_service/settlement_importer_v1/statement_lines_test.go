package settlement_importer_v1_test

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

func insertLogLine(t *testing.T, db *gorm.DB, fileID uint64, line settlement_importer_service_models.UploadedFileLine) {
	t.Helper()

	line.UploadedFileID = fileID
	if line.Sheet == "" {
		line.Sheet = "Rincian Transaksi"
	}

	if line.UniqueID == "" {
		line.UniqueID = "k"
	}

	line.CreatedAt = time.Now()

	err := db.Create(&line).Error
	if err != nil {
		t.Fatalf("insert line: %v", err)
	}
}

// THE STATEMENT A LEDGER ROW CAME FROM (the-shop-entries-page-is-accepted): one line per settlement log id — the one that
// POSTED it, with its file's platform, period and uploader — never another team's, and nothing for a row no line names.
func TestStatementLinesBySettlementLogIds_NamesThePostingLine(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	first := insertFile(t, db, team, shopeeShop, "shopee", "done", 2*time.Hour)
	again := insertFile(t, db, team, shopeeShop, "shopee", "done", time.Hour)
	theirs := insertFile(t, db, 13, 90, "shopee", "done", time.Hour)

	// Row 501 posted by the first file (its ref found no order), FOUND again by the second — the first is its statement.
	insertLogLine(t, db, again, settlement_importer_service_models.UploadedFileLine{LineNo: 1, OrderRef: "241101ABCD", Outcome: "existing", SettlementLogID: 501})
	insertLogLine(t, db, first, settlement_importer_service_models.UploadedFileLine{LineNo: 4, OrderRef: "241101ABCD", Outcome: "posted", Reason: "no_order", Description: "Penghasilan", SettlementLogID: 501})
	// Row 502: a withdrawal (no ref), and row 503 — a ref on two live orders.
	insertLogLine(t, db, first, settlement_importer_service_models.UploadedFileLine{LineNo: 5, Sheet: "Penarikan Dana", Outcome: "posted", SettlementLogID: 502})
	insertLogLine(t, db, first, settlement_importer_service_models.UploadedFileLine{LineNo: 6, OrderRef: "DUPE", Outcome: "posted", Reason: "several_orders", FoundOrderIDs: "5001,5002", SettlementLogID: 503})
	// Another team's file naming row 504, and a held line (no row).
	insertLogLine(t, db, theirs, settlement_importer_service_models.UploadedFileLine{LineNo: 1, Outcome: "posted", SettlementLogID: 504})
	insertLogLine(t, db, first, settlement_importer_service_models.UploadedFileLine{LineNo: 7, Outcome: "held", Reason: "refused"})

	lines, err := w.svc.StatementLinesBySettlementLogIds(context.Background(), team, []uint64{501, 502, 503, 504, 505})
	if err != nil {
		t.Fatalf("StatementLinesBySettlementLogIds: %v", err)
	}

	byID := map[uint64]settlement_importer_v1.StatementLineSource{}
	for _, line := range lines {
		byID[line.SettlementLogID] = line
	}

	if len(byID) != 3 {
		t.Fatalf("answered %v, want rows 501–503 only (504 is another team's, 505 nobody's)", byID)
	}

	got := byID[501]
	if got.UploadedFileID != first || got.Reason != "no_order" || got.Description != "Penghasilan" ||
		got.Platform != marketplacev1.Marketplace_MARKETPLACE_SHOPEE ||
		got.PeriodFrom != "2026-09-01" || got.PeriodTo != "2026-09-07" || got.UploadedBy != uploader {
		t.Errorf("row 501 = %+v, want the first file's posting line", got)
	}

	if byID[502].Sheet != "Penarikan Dana" || byID[502].Reason != "" {
		t.Errorf("row 502 = %+v, want the withdrawal line, no reason", byID[502])
	}

	if byID[503].Reason != "several_orders" || len(byID[503].FoundOrderIDs) != 2 {
		t.Errorf("row 503 = %+v, want several_orders naming 2 orders", byID[503])
	}

	// The root team reads every team's.
	root, err := w.svc.StatementLinesBySettlementLogIds(context.Background(), san_auth.RootTeamID, []uint64{504})
	if err != nil || len(root) != 1 || root[0].UploadedFileID != theirs {
		t.Errorf("root = %+v (%v), want the other team's line", root, err)
	}

	none, err := w.svc.StatementLinesBySettlementLogIds(context.Background(), team, nil)
	if err != nil || len(none) != 0 {
		t.Errorf("no ids = %v (%v), want nothing", none, err)
	}
}
