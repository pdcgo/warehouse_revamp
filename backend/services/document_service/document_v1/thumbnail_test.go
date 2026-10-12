package document_v1_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A public image upload gets a thumbnail_url generated on confirm.
func TestConfirmUpload_GeneratesThumbnailForImage(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	// A real 500×300 PNG so the thumbnail path actually decodes and scales something.
	img := image.NewRGBA(image.Rect(0, 0, 500, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 500; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}

	var raw bytes.Buffer

	err := png.Encode(&raw, img)
	if err != nil {
		t.Fatalf("encode png: %v", err)
	}

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       2,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PROFILE_PICTURE,
		ContentType:  "image/png",
		SizeBytes:    int64(raw.Len()),
		Filename:     "avatar.png",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), raw.Bytes())

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	// Public image → both the full public url and a thumbnail url.
	doc := conf.Msg.GetDocument()
	if doc.GetPublicUrl() == "" {
		t.Error("public image should have a public url")
	}
	if doc.GetThumbnailUrl() == "" {
		t.Fatal("expected a thumbnail_url to be generated for a public image upload")
	}
}

// A non-image upload gets no thumbnail.
func TestConfirmUpload_NoThumbnailForNonImage(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       2,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL,
		ContentType:  "application/pdf",
		SizeBytes:    5,
		Filename:     "doc.pdf",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	putBytes(t, cfg, up.Msg.GetUploadUrl(), []byte("%PDF-"))

	conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: up.Msg.GetUploadToken(),
	}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	if conf.Msg.GetDocument().GetThumbnailUrl() != "" {
		t.Errorf("non-image should have no thumbnail_url, got %q", conf.Msg.GetDocument().GetThumbnailUrl())
	}
}
