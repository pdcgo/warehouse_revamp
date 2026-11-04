package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// uploadPhotoAs runs the real two-phase upload for one team and resource type and returns the document's id.
func uploadPhotoAs(
	t *testing.T,
	documents *document_v1.Service,
	cfg docstore.Config,
	team uint64,
	resource documentv1.DocumentResourceType,
) string {
	t.Helper()

	ctx := context.Background()

	up, err := documents.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       team,
		ResourceType: resource,
		ContentType:  "image/jpeg",
		SizeBytes:    10,
		Filename:     "resi.jpg",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	key := strings.TrimPrefix(up.Msg.GetUploadUrl(), cfg.BaseURL+"/")
	if i := strings.Index(key, "?"); i >= 0 {
		key = key[:i]
	}

	path := filepath.Join(cfg.Dir, filepath.FromSlash(key))

	err = os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	err = os.WriteFile(path, []byte("\xff\xd8\xff-label"), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	conf, err := documents.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{UploadToken: up.Msg.GetUploadToken()}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	return conf.Msg.GetDocument().GetId()
}

func insertWiredRestock(t *testing.T, db *gorm.DB, seller, warehouse uint64, documentID string) uint64 {
	t.Helper()

	restock := inventory_service_models.Restock{
		TeamID: seller, WarehouseID: warehouse, Status: "ongoing", Receipt: "JNE-WIRE", ReceiptFile: documentID,
	}

	err := db.Create(&restock).Error
	if err != nil {
		t.Fatalf("insert restock: %v", err)
	}

	return restock.ID
}

// THE RESTOCK'S WAREHOUSE OPENS THE SELLER'S LABEL PHOTO THROUGH THE REAL WIRING
// (the-restocks-warehouse-opens-its-label-photo): the seller uploads the photo under its own team as the restock form
// does (an order receipt), inventory checks the restock is going to the warehouse, and the composition root's linker
// has document_service sign it for the seller as its owner — while GetDownloadUrl under the warehouse stays NotFound.
// The seam's narrow door holds: a file of another type, or of another team, is no photo.
func TestRestockPhotoLinker_TheRestocksWarehouseOpensTheSellersPhoto(t *testing.T) {
	const (
		seller    uint64 = 9_000_050
		warehouse uint64 = 9_000_051
		elsewhere uint64 = 9_000_052
		stranger  uint64 = 9_000_053
	)

	db := san_testdb.DB(t)
	ctx := context.Background()

	cfg := docstore.DefaultConfig(docstore.Config{Dir: t.TempDir(), BaseURL: "http://test.local/files", TokenSecret: "test"})
	documents := document_v1.NewService(db, cfg)
	restocks := inventory_v1.NewService(db, nil, nil, nil, nil, nil, NewRestockPhotoLinker(documents))

	photo := uploadPhotoAs(t, documents, cfg, seller, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT)
	restock := insertWiredRestock(t, db, seller, warehouse, photo)

	res, err := restocks.RestockReceiptPhoto(ctx, connect.NewRequest(&inventoryv1.RestockReceiptPhotoRequest{
		TeamId: warehouse, RequestId: restock,
	}))
	if err != nil {
		t.Fatalf("RestockReceiptPhoto: %v", err)
	}

	if !strings.Contains(res.Msg.GetUrl(), "resi.jpg") || res.Msg.GetExpiresAtUnix() == 0 {
		t.Fatalf("the restock's warehouse got %v", res.Msg)
	}

	_, err = restocks.RestockReceiptPhoto(ctx, connect.NewRequest(&inventoryv1.RestockReceiptPhotoRequest{
		TeamId: elsewhere, RequestId: restock,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another warehouse = %v, want NotFound", err)
	}

	_, err = documents.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId: warehouse, DocumentId: photo,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetDownloadUrl as the warehouse = %v — no share may have been made", err)
	}

	// The seam refuses: a payment proof of the seller (wrong type), and an order receipt of another team (wrong owner).
	proof := uploadPhotoAs(t, documents, cfg, seller, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF)
	foreign := uploadPhotoAs(t, documents, cfg, stranger, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT)

	for name, document := range map[string]string{"wrong type": proof, "wrong owner": foreign} {
		id := insertWiredRestock(t, db, seller, warehouse, document)

		_, err = restocks.RestockReceiptPhoto(ctx, connect.NewRequest(&inventoryv1.RestockReceiptPhotoRequest{
			TeamId: warehouse, RequestId: id,
		}))
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("%s: %v, want FailedPrecondition (no photo)", name, err)
		}
	}
}
