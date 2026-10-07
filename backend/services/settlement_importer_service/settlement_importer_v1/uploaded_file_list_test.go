package settlement_importer_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// insertFile writes an uploaded_files row as an import would have left it.
func insertFile(t *testing.T, db *gorm.DB, teamID, shopID uint64, platform, status string, updatedAgo time.Duration) uint64 {
	t.Helper()

	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)
	stamp := time.Now().Add(-updatedAgo)

	file := settlement_importer_service_models.UploadedFile{
		TeamID:          teamID,
		ShopID:          shopID,
		Platform:        platform,
		DocumentID:      "doc",
		ContentSha256:   "5e1a",
		PeriodFrom:      &from,
		PeriodTo:        &to,
		Status:          status,
		RowsTotal:       12,
		RowsPosted:      10,
		RowsHeld:        1,
		RowsSkipped:     1,
		CreatedByUserID: uploader,
		CreatedAt:       stamp,
		UpdatedAt:       stamp,
	}

	err := db.Create(&file).Error
	if err != nil {
		t.Fatalf("insert file: %v", err)
	}

	return file.ID
}

func listFiles(t *testing.T, w *world, filter *settlement_importerv1.UploadedFileListFilter, page uint32) *settlement_importerv1.UploadedFileListResponse {
	t.Helper()

	resp, err := w.svc.UploadedFileList(context.Background(), connect.NewRequest(&settlement_importerv1.UploadedFileListRequest{
		TeamId: team,
		Filter: filter,
		DataRequest: []settlement_importerv1.UploadedFileListDataType{
			settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_FILE,
			settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_GENERAL,
		},
		Page: &commonv1.CommonPagination{Page: page, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("UploadedFileList: %v", err)
	}

	return resp.Msg
}

// The import screen: the team's uploads, newest first, paged — another team's never among them.
func TestUploadedFileList_TheTeamsUploadsNewestFirst(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	oldest := insertFile(t, db, team, shopeeShop, "shopee", "done", 3*time.Hour)
	middle := insertFile(t, db, team, tiktokShop, "tiktok", "done", 2*time.Hour)
	newest := insertFile(t, db, team, shopeeShop, "shopee", "failed", time.Hour)
	insertFile(t, db, 13, 90, "shopee", "done", time.Minute) // another team's

	first := listFiles(t, w, nil, 1)
	if first.GetPageInfo().GetTotalItems() != 3 || first.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("page info = %+v, want 3 items over 2 pages", first.GetPageInfo())
	}

	if len(first.GetIds()) != 2 || first.GetIds()[0] != newest || first.GetIds()[1] != middle {
		t.Fatalf("page 1 = %v, want [%d %d]", first.GetIds(), newest, middle)
	}

	second := listFiles(t, w, nil, 2)
	if len(second.GetIds()) != 1 || second.GetIds()[0] != oldest {
		t.Fatalf("page 2 = %v, want [%d]", second.GetIds(), oldest)
	}

	// Both slices, keyed by the same ids.
	var file *settlement_importerv1.UploadedFile

	var name string

	for _, item := range first.GetItems() {
		if item.GetFile() != nil {
			file = item.GetFile().GetMapData()[newest]
		}

		if item.GetGeneral() != nil {
			name = item.GetGeneral().GetMapData()[newest].GetName()
		}
	}

	if file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED ||
		file.GetTally().GetPosted() != 10 || file.GetPeriodFrom() != "2026-09-01" {
		t.Errorf("the FILE slice = %+v", file)
	}

	if name != "2026-09-01 – 2026-09-07" {
		t.Errorf("the GENERAL name = %q, want the statement's own range", name)
	}
}

// A running row that has not moved for two minutes reads INTERRUPTED — worked out when read, and
// filterable, never stored (an-import-finishes-whether-anyone-watches).
func TestUploadedFileList_AStaleRunningRowReadsInterrupted(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	running := insertFile(t, db, team, shopeeShop, "shopee", "running", 10*time.Second)
	stuck := insertFile(t, db, team, shopeeShop, "shopee", "running", 10*time.Minute)
	insertFile(t, db, team, shopeeShop, "shopee", "done", time.Hour)

	interrupted := listFiles(t, w, &settlement_importerv1.UploadedFileListFilter{
		Statuses: []settlement_importerv1.UploadedFileStatus{settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_INTERRUPTED},
	}, 1)
	if len(interrupted.GetIds()) != 1 || interrupted.GetIds()[0] != stuck {
		t.Fatalf("interrupted = %v, want [%d]", interrupted.GetIds(), stuck)
	}

	runningNow := listFiles(t, w, &settlement_importerv1.UploadedFileListFilter{
		Statuses: []settlement_importerv1.UploadedFileStatus{settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_RUNNING},
	}, 1)
	if len(runningNow.GetIds()) != 1 || runningNow.GetIds()[0] != running {
		t.Fatalf("running = %v, want [%d]", runningNow.GetIds(), running)
	}

	for _, item := range interrupted.GetItems() {
		if item.GetFile() != nil &&
			item.GetFile().GetMapData()[stuck].GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_INTERRUPTED {
			t.Errorf("the stuck row reads %v", item.GetFile().GetMapData()[stuck].GetStatus())
		}
	}
}

// Filtered by shop and by platform.
func TestUploadedFileList_FiltersByShopAndPlatform(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	shopee := insertFile(t, db, team, shopeeShop, "shopee", "done", time.Hour)
	tiktok := insertFile(t, db, team, tiktokShop, "tiktok", "done", time.Hour)

	byShop := listFiles(t, w, &settlement_importerv1.UploadedFileListFilter{ShopId: tiktokShop}, 1)
	if len(byShop.GetIds()) != 1 || byShop.GetIds()[0] != tiktok {
		t.Fatalf("by shop = %v, want [%d]", byShop.GetIds(), tiktok)
	}

	byPlatform := listFiles(t, w, &settlement_importerv1.UploadedFileListFilter{Platform: marketplacev1.Marketplace_MARKETPLACE_SHOPEE}, 1)
	if len(byPlatform.GetIds()) != 1 || byPlatform.GetIds()[0] != shopee {
		t.Fatalf("by platform = %v, want [%d]", byPlatform.GetIds(), shopee)
	}
}
