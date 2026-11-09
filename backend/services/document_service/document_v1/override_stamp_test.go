package document_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// asCaller is a request context as the access interceptor leaves it: who is calling, the team the call is scoped to,
// and their role there. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asCaller(userID, scope uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, scope)

	return san_auth.WithCallerRole(ctx, role)
}

func uploadedOverride(t *testing.T, db *gorm.DB, ctx context.Context, filename string, svc interface {
	RequestUpload(context.Context, *connect.Request[documentv1.RequestUploadRequest]) (*connect.Response[documentv1.RequestUploadResponse], error)
}) bool {
	t.Helper()

	_, err := svc.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       payerTeam,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF,
		ContentType:  "image/png",
		SizeBytes:    9,
		Filename:     filename,
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	var doc document_service_models.Document

	err = db.Where("team_id = ? AND filename = ?", payerTeam, filename).Take(&doc).Error
	if err != nil {
		t.Fatalf("read the pending document: %v", err)
	}

	return doc.IsOverride
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): a file Root uploads from outside the team says so,
// and one the team's own CS uploads does not.
func TestRequestUpload_StampsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newService(t, db)

	if !uploadedOverride(t, db, asCaller(1, payerTeam, role_basev1.Role_ROLE_UNSPECIFIED), "by-root.png", svc) {
		t.Error("Root's upload from outside the team is not marked an override")
	}

	if uploadedOverride(t, db, asCaller(42, payerTeam, role_basev1.Role_ROLE_SELLING_CS), "by-cs.png", svc) {
		t.Error("the CS's upload is marked an override")
	}
}

// A SHARE is granted in the OWNER's scope, so its flag is about the owner team — Root sharing a payer's proof from
// outside the payer team is an override, the payer's own owner sharing it is not.
func TestShareDocument_StampsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc, cfg := newService(t, db)

	for _, c := range []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"Root", asCaller(1, payerTeam, role_basev1.Role_ROLE_UNSPECIFIED), true},
		{"the payer's owner", asCaller(42, payerTeam, role_basev1.Role_ROLE_SELLING_OWNER), false},
	} {
		docID := uploadProof(t, svc, cfg, payerTeam)

		_, err := svc.ShareDocument(c.ctx, connect.NewRequest(&documentv1.ShareDocumentRequest{
			TeamId: payerTeam, DocumentId: docID, WithTeamId: creditorTeam,
		}))
		if err != nil {
			t.Fatalf("%s: ShareDocument: %v", c.name, err)
		}

		var share document_service_models.DocumentShare

		err = db.Where("document_id = ? AND team_id = ?", docID, creditorTeam).Take(&share).Error
		if err != nil {
			t.Fatalf("%s: read the share: %v", c.name, err)
		}

		if share.IsOverride != c.want {
			t.Errorf("%s: is_override = %v, want %v", c.name, share.IsOverride, c.want)
		}
	}
}
