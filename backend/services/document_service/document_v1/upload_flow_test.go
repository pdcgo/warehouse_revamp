package document_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The private happy path: request → PUT → confirm → download a short-lived signed URL.
func TestUploadFlow_PrivateDocument(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       2,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL,
		ContentType:  "application/pdf",
		SizeBytes:    12,
		Filename:     "receipt.pdf",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}
	if up.Msg.GetMethod() != "PUT" || up.Msg.GetUploadToken() == "" {
		t.Fatalf("bad RequestUpload response: %+v", up.Msg)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("hello, world"))

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}
	doc := conf.Msg.GetDocument()
	if doc.GetId() == "" || doc.GetPublicUrl() != "" {
		t.Fatalf("private doc should have an id and NO public url: %+v", doc)
	}

	dl, err := svc.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId: 2, DocumentId: doc.GetId(),
	}))
	if err != nil {
		t.Fatalf("GetDownloadUrl: %v", err)
	}
	if dl.Msg.GetPublic() || dl.Msg.GetExpiresAtUnix() == 0 || dl.Msg.GetUrl() == "" {
		t.Fatalf("private download should be non-public, time-limited, non-empty: %+v", dl.Msg)
	}
}

// The public path: a profile picture gets a stable public URL and no expiry.
func TestUploadFlow_PublicImage(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       2,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PROFILE_PICTURE,
		ContentType:  "image/png",
		SizeBytes:    4,
		Filename:     "avatar.png",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("png!"))

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}
	if conf.Msg.GetDocument().GetPublicUrl() == "" {
		t.Fatal("public image should have a public url after confirm")
	}

	dl, err := svc.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId: 2, DocumentId: conf.Msg.GetDocument().GetId(),
	}))
	if err != nil {
		t.Fatalf("GetDownloadUrl: %v", err)
	}
	if !dl.Msg.GetPublic() || dl.Msg.GetExpiresAtUnix() != 0 {
		t.Fatalf("public download should be public with no expiry: %+v", dl.Msg)
	}
}

// A product image (#60/#80) is public like an avatar and MUST be an allowed resource_type — the
// pending row is inserted at RequestUpload, so a missing value in the documents_resource_type_valid
// CHECK fails here with a constraint violation (this is the #80 regression).
func TestUploadFlow_ProductImage(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       2,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PRODUCT_IMAGE,
		ContentType:  "image/jpeg",
		SizeBytes:    4,
		Filename:     "product.jpg",
	}))
	if err != nil {
		t.Fatalf("RequestUpload (product image): %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("jpg!"))

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload (product image): %v", err)
	}
	// Public, so it carries a stable URL — which is exactly what the product row stores.
	if conf.Msg.GetDocument().GetPublicUrl() == "" {
		t.Fatal("product image should have a public url after confirm")
	}
}

// Confirm before the bytes land is a precondition failure, not a success.
func TestConfirmUpload_MissingBytes(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newService(t, db)
	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId: 2, ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL,
		ContentType: "application/pdf", SizeBytes: 10, Filename: "x.pdf",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	// No putBytes — the object was never uploaded.
	_, err = svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// A forged/garbage token is rejected — the HMAC guards it.
func TestConfirmUpload_ForgedTokenRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newService(t, db)

	_, err := svc.ConfirmUpload(context.Background(), connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: "not.a.valid.token",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// GetDownloadUrl is team-scoped: another team can't fetch a URL for this team's document.
func TestGetDownloadUrl_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	up, _ := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId: 2, ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL,
		ContentType: "application/pdf", SizeBytes: 3, Filename: "secret.pdf",
	}))
	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("abc"))
	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	// Team 3 asks for team 2's document.
	_, err = svc.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId: 3, DocumentId: conf.Msg.GetDocument().GetId(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team download code = %v, want NotFound", connect.CodeOf(err))
	}
}

// An over-limit upload is refused up front.
func TestRequestUpload_TooLarge(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newService(t, db)

	_, err := svc.RequestUpload(context.Background(), connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId: 2, ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL,
		ContentType: "application/pdf", SizeBytes: 11 << 20, Filename: "huge.pdf",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}
