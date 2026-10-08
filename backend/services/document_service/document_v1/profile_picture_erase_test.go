package document_v1_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// storedPhoto writes a document row and its files (original and thumbnail) the way a confirmed upload leaves them.
func storedPhoto(t *testing.T, db *gorm.DB, cfg docstore.Config, id, resourceType string, uploader uint64) document_service_models.Document {
	t.Helper()

	doc := document_service_models.Document{
		ID:           id,
		TeamID:       9,
		ResourceType: resourceType,
		ObjectKey:    "test/" + id,
		ThumbnailKey: "test/" + id + ".thumb",
		CreatedByID:  uploader,
		Status:       "active",
	}

	err := db.Create(&doc).Error
	if err != nil {
		t.Fatalf("insert document: %v", err)
	}

	for _, key := range []string{doc.ObjectKey, doc.ThumbnailKey} {
		path := filepath.Join(cfg.Dir, filepath.FromSlash(key))

		err = os.MkdirAll(filepath.Dir(path), 0o755)
		if err != nil {
			t.Fatalf("mkdir: %v", err)
		}

		err = os.WriteFile(path, []byte("png!"), 0o644)
		if err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}

	return doc
}

func fileExists(cfg docstore.Config, key string) bool {
	_, err := os.Stat(filepath.Join(cfg.Dir, filepath.FromSlash(key)))

	return err == nil
}

func rowExists(db *gorm.DB, id string) bool {
	var n int64

	db.Model(&document_service_models.Document{}).Where("id = ?", id).Count(&n)

	return n > 0
}

// erase-deletes-the-photo-file: every profile picture the person uploaded goes — the files, original and thumbnail,
// and the rows, a shared one's share too. Somebody else's photo, and the person's other documents, stay.
func TestProfilePictureErase_DeletesEveryPhotoOfThePerson(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	const ani, budi = 57, 58

	current := storedPhoto(t, db, cfg, "erase-current", "profile_picture", ani)
	replaced := storedPhoto(t, db, cfg, "erase-replaced", "profile_picture", ani)
	theirs := storedPhoto(t, db, cfg, "erase-budi", "profile_picture", budi)
	general := storedPhoto(t, db, cfg, "erase-general", "general", ani)

	err := db.Create(&document_service_models.DocumentShare{DocumentID: replaced.ID, TeamID: 12, GrantedBy: ani}).Error
	if err != nil {
		t.Fatalf("share: %v", err)
	}

	res, err := svc.ProfilePictureErase(context.Background(), connect.NewRequest(&documentv1.ProfilePictureEraseRequest{UserId: ani}))
	if err != nil {
		t.Fatalf("ProfilePictureErase: %v", err)
	}

	if res.Msg.GetErased() != 2 {
		t.Errorf("erased = %d, want 2 (the current photo and the one it replaced)", res.Msg.GetErased())
	}

	for _, doc := range []document_service_models.Document{current, replaced} {
		if rowExists(db, doc.ID) || fileExists(cfg, doc.ObjectKey) || fileExists(cfg, doc.ThumbnailKey) {
			t.Errorf("%s: row %v, file %v, thumbnail %v — want all gone", doc.ID,
				rowExists(db, doc.ID), fileExists(cfg, doc.ObjectKey), fileExists(cfg, doc.ThumbnailKey))
		}
	}

	for _, doc := range []document_service_models.Document{theirs, general} {
		if !rowExists(db, doc.ID) || !fileExists(cfg, doc.ObjectKey) {
			t.Errorf("%s was deleted — only the person's PROFILE pictures go", doc.ID)
		}
	}

	// Again: nothing left, which is not an error — it is how a retry after a failure ends.
	res, err = svc.ProfilePictureErase(context.Background(), connect.NewRequest(&documentv1.ProfilePictureEraseRequest{UserId: ani}))
	if err != nil || res.Msg.GetErased() != 0 {
		t.Errorf("a second erase: erased %d, err %v — want 0 and no error", res.Msg.GetErased(), err)
	}
}
