package document_v1_test

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// a-warehouse-prints-the-labels-of-orders-it-ships: the merged labels are stored as a private ORDER_LABELS document of
// the warehouse — active at once, its bytes in the asset prefix — and the link carries the file's name. The warehouse
// reads it back as its own; another team cannot.
func TestStoreOrderLabels_StoresAPrivateFileOfTheWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	const warehouse = creditorTeam

	content := []byte("%PDF-merged labels")

	url, expiresAt, err := svc.StoreOrderLabels(context.Background(), warehouse, "labels-2026-11-09-101500.pdf", content)
	if err != nil {
		t.Fatalf("StoreOrderLabels: %v", err)
	}

	if !strings.HasPrefix(url, testBaseURL) || !strings.Contains(url, "labels-2026-11-09-101500.pdf") || expiresAt.IsZero() {
		t.Fatalf("url = %q, expires %v", url, expiresAt)
	}

	var docs []document_service_models.Document

	err = db.Where("team_id = ? AND resource_type = ?", warehouse, "order_labels").Find(&docs).Error
	if err != nil || len(docs) != 1 {
		t.Fatalf("rows = %v, %v", docs, err)
	}

	doc := docs[0]
	if doc.Status != "active" || doc.MimeType != "application/pdf" || doc.SizeBytes != int64(len(content)) ||
		doc.PublicURL != "" || !strings.HasPrefix(doc.ObjectKey, docstore.AssetPrefix+"/") {
		t.Fatalf("row = %+v", doc)
	}

	r, err := docstore.NewLocalStore(cfg).Open(doc.ObjectKey)
	if err != nil {
		t.Fatal(err)
	}

	stored, _ := io.ReadAll(r)
	_ = r.Close()

	if !bytes.Equal(stored, content) {
		t.Fatalf("stored %q", stored)
	}

	if err = download(svc, doc.ID, warehouse); err != nil {
		t.Fatalf("the warehouse reads its own print: %v", err)
	}

	if err = download(svc, doc.ID, payerTeam); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another team = %v, want NotFound", err)
	}
}

// No browser stores an ORDER_LABELS file: it is the order service's answer, made from labels it has checked.
func TestStoreOrderLabels_TheTypeIsNeverUploaded(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newService(t, db)

	_, err := svc.RequestUpload(context.Background(), connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId: creditorTeam, ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_LABELS,
		ContentType: "application/pdf", SizeBytes: 10, Filename: "labels.pdf",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("RequestUpload ORDER_LABELS = %v, want InvalidArgument", err)
	}
}
