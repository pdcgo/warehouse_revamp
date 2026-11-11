package settlement_importer_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// One file's page reads its own row by id — and another team's file is ABSENT, as if it did not exist.
func TestUploadedFileByIds_ReadsTheTeamsFilesOnly(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	mine := insertFile(t, db, team, shopeeShop, "shopee", "done", time.Hour)
	theirs := insertFile(t, db, 13, 90, "shopee", "done", time.Hour)

	resp, err := w.svc.UploadedFileByIds(context.Background(), connect.NewRequest(&settlement_importerv1.UploadedFileByIdsRequest{
		TeamId: team,
		Filter: &settlement_importerv1.UploadedFileByIdsFilter{Ids: []uint64{mine, theirs}},
	}))
	if err != nil {
		t.Fatalf("UploadedFileByIds: %v", err)
	}

	items := resp.Msg.GetItems()
	if len(items) != 1 {
		t.Fatalf("%d files answered, want only the team's own", len(items))
	}

	list := items[mine]
	if list == nil || len(list.GetItems()) != 1 {
		t.Fatalf("file %d = %+v", mine, list)
	}

	file := list.GetItems()[0].GetFile().GetMapData()[mine]
	if file.GetId() != mine || file.GetShopId() != shopeeShop ||
		file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE {
		t.Fatalf("the FILE slice (the default) = %+v", file)
	}
}

// BY IDS READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): the import's own page names its uploader with the
// "by Root team" badge when Root uploaded it from outside the team, and without it for a member's upload.
func TestUploadedFileByIds_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	byRoot := insertFile(t, db, team, shopeeShop, "shopee", "done", 2*time.Hour)
	byMember := insertFile(t, db, team, shopeeShop, "shopee", "done", time.Hour)

	err := db.Model(&settlement_importer_service_models.UploadedFile{}).Where("id = ?", byRoot).Update("is_override", true).Error
	if err != nil {
		t.Fatalf("stamp Root's file: %v", err)
	}

	resp, err := w.svc.UploadedFileByIds(context.Background(), connect.NewRequest(&settlement_importerv1.UploadedFileByIdsRequest{
		TeamId: team,
		Filter: &settlement_importerv1.UploadedFileByIdsFilter{Ids: []uint64{byRoot, byMember}},
	}))
	if err != nil {
		t.Fatalf("UploadedFileByIds: %v", err)
	}

	read := func(id uint64) bool {
		return resp.Msg.GetItems()[id].GetItems()[0].GetFile().GetMapData()[id].GetIsOverride()
	}

	if !read(byRoot) || read(byMember) {
		t.Fatalf("is_override: Root's file %v, the member's %v — want true, false", read(byRoot), read(byMember))
	}
}
