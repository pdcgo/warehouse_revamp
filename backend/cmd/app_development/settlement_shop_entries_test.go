package main

import (
	"context"
	"testing"
	"time"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// SHOP ENTRIES' SEAMS: settlement's StatementSources answered by the importer's own line, and UserNames by the user
// read — each field copied across, keyed by the settlement row.
func TestSettlementShopEntrySeams_AnswerFromTheImporterAndTheUsers(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	uploader := user_service_models.User{Name: "Budi Santoso", Username: "budiseam", Password: "x"}

	err := db.Create(&uploader).Error
	if err != nil {
		t.Fatalf("user: %v", err)
	}

	from := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	file := settlement_importer_service_models.UploadedFile{
		TeamID: 12, ShopID: 21, Platform: "shopee", DocumentID: "doc", ContentSha256: "5e1a", Status: "done",
		PeriodFrom: &from, PeriodTo: &to, CreatedByUserID: uploader.ID,
	}

	err = db.Create(&file).Error
	if err != nil {
		t.Fatalf("file: %v", err)
	}

	line := settlement_importer_service_models.UploadedFileLine{
		UploadedFileID: file.ID, LineNo: 1, Sheet: "Rincian Transaksi", UniqueID: "k", OrderRef: "241101ABCD",
		Outcome: "posted", Reason: "no_order", SettlementLogID: 7101, CreatedAt: time.Now(),
	}

	err = db.Create(&line).Error
	if err != nil {
		t.Fatalf("line: %v", err)
	}

	sources := NewSettlementStatementSources(settlement_importer_v1.NewService(db, nil, nil, nil, nil))

	lines, err := sources.StatementLines(ctx, 12, []uint64{7101, 7102})
	if err != nil {
		t.Fatalf("StatementLines: %v", err)
	}

	got, ok := lines[7101]
	if !ok || len(lines) != 1 || got.UploadedFileID != file.ID || got.Platform != marketplacev1.Marketplace_MARKETPLACE_SHOPEE ||
		got.PeriodFrom != "2026-11-01" || got.PeriodTo != "2026-11-02" || got.OrderRef != "241101ABCD" ||
		got.Reason != "no_order" || got.UploadedBy != uploader.ID {
		t.Fatalf("lines = %+v, want row 7101's posting line only", lines)
	}

	names := NewSettlementUserNames(user_v1.NewService(db, nil, nil, nil, nil, nil, nil))

	named, err := names.UserNames(ctx, []uint64{uploader.ID, 999_999})
	if err != nil {
		t.Fatalf("UserNames: %v", err)
	}

	if len(named) != 1 || named[uploader.ID] != "Budi Santoso" {
		t.Fatalf("names = %v, want only Budi Santoso", named)
	}
}
