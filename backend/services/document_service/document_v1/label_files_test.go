package document_v1_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// uploadFile runs the real upload flow with the given bytes and type, and returns the finished document's id.
func uploadFile(
	t *testing.T,
	svc *document_v1.Service,
	cfg docstore.Config,
	teamID uint64,
	resource documentv1.DocumentResourceType,
	filename, mimeType string,
	content []byte,
) string {
	t.Helper()

	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       teamID,
		ResourceType: resource,
		ContentType:  mimeType,
		SizeBytes:    int64(len(content)),
		Filename:     filename,
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), content)

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	return conf.Msg.GetDocument().GetId()
}

// a-warehouse-prints-the-labels-of-orders-it-ships, the document side of a merge: the bytes of the owner's active order
// receipts, with their stored type — and nothing for any other id, owner or resource type, exactly as LabelURL.
func TestLabelFiles_ReadsOnlyTheOwnersOrderReceipts(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	pdf := uploadFile(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
		"resi.pdf", "application/pdf", []byte("%PDF-one"))
	photo := uploadFile(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
		"resi.jpg", "image/jpeg", []byte("jpeg-bytes"))
	general := uploadFile(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL,
		"notes.pdf", "application/pdf", []byte("%PDF-general"))

	files, err := svc.LabelFiles(context.Background(), []document_v1.LabelRef{
		{OwnerTeamID: payerTeam, DocumentID: pdf},
		{OwnerTeamID: payerTeam, DocumentID: photo},
		{OwnerTeamID: creditorTeam, DocumentID: pdf}, // the wrong owner: the id alone opens nothing
		{OwnerTeamID: payerTeam, DocumentID: general},
		{OwnerTeamID: payerTeam, DocumentID: "no-such-document"},
	})
	if err != nil {
		t.Fatalf("LabelFiles: %v", err)
	}

	if len(files) != 2 {
		t.Fatalf("files = %v, want the two receipts only", files)
	}

	if got := files[pdf]; !bytes.Equal(got.Content, []byte("%PDF-one")) || got.MimeType != "application/pdf" || got.Filename != "resi.pdf" {
		t.Fatalf("the PDF: %+v", got)
	}

	if got := files[photo]; !bytes.Equal(got.Content, []byte("jpeg-bytes")) || got.MimeType != "image/jpeg" {
		t.Fatalf("the photo: %+v", got)
	}

	// Asked for under the wrong owner ONLY: absent.
	only, err := svc.LabelFiles(context.Background(), []document_v1.LabelRef{{OwnerTeamID: creditorTeam, DocumentID: pdf}})
	if err != nil || len(only) != 0 {
		t.Fatalf("wrong owner: %v, %v", only, err)
	}
}

// A row whose bytes are gone from storage is still a label — with no content, which the order service reports as "the
// file can't be read", not as "no label". A request never confirmed is no label at all.
func TestLabelFiles_AFileGoneFromStorageHasNoContent(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	label := uploadFile(t, svc, cfg, payerTeam, documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
		"resi.pdf", "application/pdf", []byte("%PDF-gone"))

	var doc document_service_models.Document

	err := db.Where("id = ?", label).First(&doc).Error
	if err != nil {
		t.Fatal(err)
	}

	err = os.Remove(filepath.Join(cfg.Dir, filepath.FromSlash(doc.ObjectKey)))
	if err != nil {
		t.Fatal(err)
	}

	pending, err := svc.RequestUpload(context.Background(), connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId: payerTeam, ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
		ContentType: "application/pdf", SizeBytes: 5, Filename: "never.pdf",
	}))
	if err != nil {
		t.Fatal(err)
	}

	var pendingDoc document_service_models.Document

	err = db.Where("team_id = ? AND filename = ?", payerTeam, "never.pdf").First(&pendingDoc).Error
	if err != nil || pending.Msg.GetUploadToken() == "" {
		t.Fatalf("pending row: %v", err)
	}

	files, err := svc.LabelFiles(context.Background(), []document_v1.LabelRef{
		{OwnerTeamID: payerTeam, DocumentID: label},
		{OwnerTeamID: payerTeam, DocumentID: pendingDoc.ID},
	})
	if err != nil {
		t.Fatalf("LabelFiles: %v", err)
	}

	got, ok := files[label]
	if !ok || got.Content != nil {
		t.Fatalf("the gone file: present %v, %d bytes — want present with no content", ok, len(got.Content))
	}

	if _, ok = files[pendingDoc.ID]; ok {
		t.Fatal("a never-confirmed upload was read as a label")
	}
}
