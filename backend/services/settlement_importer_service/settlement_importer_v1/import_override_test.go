package settlement_importer_v1_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// rolesIn is a resolver: the person's role per team, and in the root team.
type rolesIn map[uint64]role_basev1.Role

func (r rolesIn) Resolve(_ context.Context, _ uint64, teamID uint64) (access_interceptors.Access, error) {
	return access_interceptors.Access{Role: r[teamID], RootRole: r[san_auth.RootTeamID]}, nil
}

func (rolesIn) Invalidate(context.Context, uint64) error { return nil }

// importThroughTheInterceptor runs a Tiktok import through the REAL access interceptor, as `resolver`'s person.
func importThroughTheInterceptor(t *testing.T, w *world, resolver access_interceptors.RoleResolver) {
	t.Helper()

	signer := san_auth.NewSigner("test-secret", time.Hour)

	token, err := signer.Sign(&role_basev1.Identity{IdentityId: uploader}, time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle(settlement_importerv1connect.NewSettlementImporterServiceHandler(w.svc,
		connect.WithInterceptors(access_interceptors.NewInterceptor(signer, resolver))))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	req := connect.NewRequest(&settlement_importerv1.TiktokSettlementImportRequest{
		TeamId: team, ShopId: tiktokShop, FileContent: aTiktokWeek(t),
	})
	req.Header().Set("Authorization", "Bearer "+token)

	stream, err := settlement_importerv1connect.NewSettlementImporterServiceClient(server.Client(), server.URL).
		TiktokSettlementImport(context.Background(), req)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	defer stream.Close()

	for stream.Receive() {
	}

	if stream.Err() != nil {
		t.Fatalf("stream: %v", stream.Err())
	}
}

// AN UPLOAD BY ROOT, in a team it holds no role in, is stamped an override (an-override-is-stamped-in-every-service) —
// an import is a server stream, and its handler reads the scope and the caller role the interceptor fills.
func TestImport_RootsUploadIsStampedAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	importThroughTheInterceptor(t, w, rolesIn{san_auth.RootTeamID: role_basev1.Role_ROLE_ROOT})

	files := fileRows(t, db)
	if len(files) != 1 || !files[0].IsOverride {
		t.Fatalf("files = %+v, want one stamped an override", files)
	}
}

// …and a member's upload is not.
func TestImport_AMembersUploadIsNoOverride(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	importThroughTheInterceptor(t, w, rolesIn{team: role_basev1.Role_ROLE_SELLING_OWNER})

	files := fileRows(t, db)
	if len(files) != 1 || files[0].IsOverride {
		t.Fatalf("files = %+v, want one, not an override", files)
	}
}
