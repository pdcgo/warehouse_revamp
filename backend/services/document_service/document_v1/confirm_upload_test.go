package document_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once: the ceiling is 15 MiB, and ConfirmUpload holds it on
// the bytes that LANDED — not on the size RequestUpload was told, which the browser chose. Both cases declare exactly
// 15 MiB, so RequestUpload lets them through; only what was PUT tells them apart.
func TestConfirmUpload_FifteenMBIsTheCeiling(t *testing.T) {
	const ceiling = 15 << 20

	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)
	ctx := context.Background()

	if cfg.MaxSizeBytes != ceiling {
		t.Fatalf("the default ceiling is %d bytes, want 15 MiB (%d)", cfg.MaxSizeBytes, ceiling)
	}

	for _, c := range []struct {
		name   string
		landed int
		want   connect.Code
	}{
		{"exactly 15 MiB is accepted", ceiling, 0},
		{"15 MiB and one byte is refused", ceiling + 1, connect.CodeInvalidArgument},
	} {
		t.Run(c.name, func(t *testing.T) {
			up, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
				TeamId:       2,
				ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
				ContentType:  "application/pdf",
				SizeBytes:    ceiling,
				Filename:     "label.pdf",
			}))
			if err != nil {
				t.Fatalf("RequestUpload: %v", err)
			}

			putBytes(t, cfg, up.Msg.GetUploadUrl(), make([]byte, c.landed))

			conf, err := svc.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
				UploadToken: up.Msg.GetUploadToken(),
			}))

			if c.want != 0 {
				if connect.CodeOf(err) != c.want {
					t.Fatalf("err = %v, want %v", err, c.want)
				}

				return
			}

			if err != nil {
				t.Fatalf("ConfirmUpload: %v", err)
			}

			if got := conf.Msg.GetDocument().GetSizeBytes(); got != ceiling {
				t.Fatalf("size_bytes = %d, want the %d that landed", got, ceiling)
			}
		})
	}
}
