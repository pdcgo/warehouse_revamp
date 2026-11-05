package inventory_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const (
	photoSeller    uint64 = 2
	photoWarehouse uint64 = 5
)

// fakePhotoLinker is document_service's LabelURL: it signs only the documents it holds, for their owner.
type fakePhotoLinker struct {
	// document id → owner team
	owners map[string]uint64
	asked  []string
	err    error
}

func (f *fakePhotoLinker) LabelURL(_ context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	f.asked = append(f.asked, documentID)

	if f.err != nil {
		return "", time.Time{}, f.err
	}

	owner, ok := f.owners[documentID]
	if !ok || owner != ownerTeamID {
		return "", time.Time{}, connect.NewError(connect.CodeNotFound, errors.New("document not found"))
	}

	return "https://files.invalid/" + documentID, time.Unix(1_900_000_000, 0), nil
}

func photoService(db *gorm.DB, linker inventory_v1.ReceiptPhotoLinker) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, nil, nil, linker, nil)
}

// insertPhotoRestock writes a restock of selling team 2 going to `warehouse`, with a label photo or none.
func insertPhotoRestock(t *testing.T, db *gorm.DB, warehouse uint64, documentID string) uint64 {
	t.Helper()

	restock := inventory_service_models.Restock{
		TeamID:      photoSeller,
		WarehouseID: warehouse,
		Status:      "ongoing",
		Receipt:     "JNE-PHOTO",
		ReceiptFile: documentID,
	}

	err := db.Create(&restock).Error
	if err != nil {
		t.Fatalf("insert restock: %v", err)
	}

	return restock.ID
}

func receiptPhoto(svc *inventory_v1.Service, teamID, requestID uint64) (*inventoryv1.RestockReceiptPhotoResponse, error) {
	res, err := svc.RestockReceiptPhoto(context.Background(), connect.NewRequest(&inventoryv1.RestockReceiptPhotoRequest{
		TeamId:    teamID,
		RequestId: requestID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// the-restocks-warehouse-opens-its-label-photo: the warehouse a restock is going to gets a link to its label photo —
// the seller's document, signed for the seller's team as its owner, without any share.
func TestRestockReceiptPhoto_TheRestocksWarehouseGetsTheLink(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakePhotoLinker{owners: map[string]uint64{"doc-photo": photoSeller}}
	svc := photoService(db, linker)

	restock := insertPhotoRestock(t, db, photoWarehouse, "doc-photo")

	res, err := receiptPhoto(svc, photoWarehouse, restock)
	if err != nil {
		t.Fatalf("RestockReceiptPhoto: %v", err)
	}

	if res.GetUrl() != "https://files.invalid/doc-photo" || res.GetExpiresAtUnix() != 1_900_000_000 {
		t.Fatalf("link = %q, expires %d", res.GetUrl(), res.GetExpiresAtUnix())
	}
}

// Another warehouse is refused — NotFound, the same answer as an id that does not exist — and document_service is
// never asked. The selling team itself is refused here too: it opens its own upload with GetDownloadUrl.
func TestRestockReceiptPhoto_AnotherWarehouseIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakePhotoLinker{owners: map[string]uint64{"doc-photo": photoSeller}}
	svc := photoService(db, linker)

	restock := insertPhotoRestock(t, db, photoWarehouse, "doc-photo")

	for name, ask := range map[string][2]uint64{
		"another warehouse's restock": {photoWarehouse + 1, restock},
		"no such restock":             {photoWarehouse, restock + 10_000},
		"the selling team as scope":   {photoSeller, restock},
	} {
		_, err := receiptPhoto(svc, ask[0], ask[1])
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s: err = %v, want NotFound", name, err)
		}
	}

	if len(linker.asked) != 0 {
		t.Fatalf("document_service was asked for %v before the check passed", linker.asked)
	}
}

// A restock with no photo attached is FailedPrecondition "no label photo"; so is one whose file document_service no
// longer holds for the seller — the seam refusing the wrong owner reads the same.
func TestRestockReceiptPhoto_NoPhotoIsSaid(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakePhotoLinker{owners: map[string]uint64{"doc-other-team": photoSeller + 1}}
	svc := photoService(db, linker)

	for name, document := range map[string]string{"none attached": "", "the file is not the seller's": "doc-other-team"} {
		restock := insertPhotoRestock(t, db, photoWarehouse, document)

		res, err := receiptPhoto(svc, photoWarehouse, restock)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition || res != nil {
			t.Fatalf("%s: %v, %v — want FailedPrecondition", name, res, err)
		}

		var cerr *connect.Error
		if !errors.As(err, &cerr) || cerr.Message() != "this restock has no label photo" {
			t.Fatalf("%s: message = %v", name, err)
		}
	}

	if !slices.Equal(linker.asked, []string{"doc-other-team"}) {
		t.Fatalf("asked = %v, want only the attached file", linker.asked)
	}
}

// A document_service failure that is not "not there" is the call's error, never a quiet "no photo"; an unwired server
// says Unimplemented.
func TestRestockReceiptPhoto_ALinkerFailureIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := photoService(db, &fakePhotoLinker{err: connect.NewError(connect.CodeUnavailable, errors.New("down"))})

	restock := insertPhotoRestock(t, db, photoWarehouse, "doc-photo")

	_, err := receiptPhoto(svc, photoWarehouse, restock)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}

	_, err = receiptPhoto(photoService(db, nil), photoWarehouse, restock)
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no linker: %v, want Unimplemented", err)
	}
}

// Who may ask: the warehouse's three roles and Root and the Administrator — never a selling role, who keeps opening its
// own upload with GetDownloadUrl. A read: an agent and the monitor may call it.
func TestRestockReceiptPhoto_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockReceiptPhotoRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("RestockReceiptPhotoRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v", policy.GetRoles(), want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockReceiptPhoto")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockReceiptPhoto must be marked NO_SIDE_EFFECTS")
	}
}
