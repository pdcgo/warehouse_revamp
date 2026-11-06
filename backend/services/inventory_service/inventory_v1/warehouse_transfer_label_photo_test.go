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
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// every-side-of-a-transfer-opens-its-label-photo — the selling team 8 moves goods from warehouse 5 (A) to 6 (B); A's
// crew attached the label photo at ship, so the document is A's.
const (
	lpSeller   uint64 = 8
	lpSender   uint64 = 5
	lpReceiver uint64 = 6
	lpStranger uint64 = 7
)

// insertLabelTransfer writes a shipped transfer of the seller from A to B, with a label photo or none.
func insertLabelTransfer(t *testing.T, db *gorm.DB, documentID string) uint64 {
	t.Helper()

	shipped := time.Now()
	transfer := models.WarehouseTransfer{
		TeamID:          lpSeller,
		FromWarehouseID: lpSender,
		ToWarehouseID:   lpReceiver,
		Status:          models.TransferShipped,
		Receipt:         "JNE-TRANSFER",
		ReceiptFile:     documentID,
		ShippedAt:       &shipped,
	}

	err := db.Create(&transfer).Error
	if err != nil {
		t.Fatalf("insert transfer: %v", err)
	}

	return transfer.ID
}

func transferLabelPhoto(svc *inventory_v1.Service, teamID, transferID uint64) (*inventoryv1.WarehouseTransferLabelPhotoResponse, error) {
	res, err := svc.WarehouseTransferLabelPhoto(context.Background(),
		connect.NewRequest(&inventoryv1.WarehouseTransferLabelPhotoRequest{TeamId: teamID, TransferId: transferID}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// THE THREE SIDES each get the link — A whose upload it is, B matching the parcel at its door, and the selling team that
// owns the transfer — and every time the photo is signed for A, its owner, never for the caller.
func TestWarehouseTransferLabelPhoto_EverySideGetsTheLink(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakePhotoLinker{owners: map[string]uint64{"doc-transfer": lpSender}}
	svc := photoService(db, linker)

	transfer := insertLabelTransfer(t, db, "doc-transfer")

	for name, team := range map[string]uint64{"the sender A": lpSender, "the receiver B": lpReceiver, "the selling team": lpSeller} {
		res, err := transferLabelPhoto(svc, team, transfer)
		if err != nil {
			t.Fatalf("%s: WarehouseTransferLabelPhoto: %v", name, err)
		}

		if res.GetUrl() != "https://files.invalid/doc-transfer" || res.GetExpiresAtUnix() != 1_900_000_000 {
			t.Fatalf("%s: link = %q, expires %d", name, res.GetUrl(), res.GetExpiresAtUnix())
		}
	}

	if !slices.Equal(linker.asked, []string{"doc-transfer", "doc-transfer", "doc-transfer"}) {
		t.Fatalf("asked = %v, want the transfer's photo three times", linker.asked)
	}
}

// A FOURTH TEAM IS REFUSED — NotFound, the same answer as an id that does not exist — and document_service is never
// asked. Root's scope is no side of this transfer either: it names the team it reads for, as on Detail.
func TestWarehouseTransferLabelPhoto_AnyOtherTeamIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakePhotoLinker{owners: map[string]uint64{"doc-transfer": lpSender}}
	svc := photoService(db, linker)

	transfer := insertLabelTransfer(t, db, "doc-transfer")

	for name, ask := range map[string][2]uint64{
		"a fourth team":       {lpStranger, transfer},
		"the root team":       {san_auth.RootTeamID, transfer},
		"no such transfer":    {lpSender, transfer + 10_000},
		"another's id, by B":  {lpReceiver, transfer + 10_000},
		"the seller, unknown": {lpSeller, transfer + 10_000},
	} {
		_, err := transferLabelPhoto(svc, ask[0], ask[1])
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s: err = %v, want NotFound", name, err)
		}
	}

	if len(linker.asked) != 0 {
		t.Fatalf("document_service was asked for %v before the check passed", linker.asked)
	}
}

// No photo attached (not shipped yet, or shipped without one) is FailedPrecondition "no label photo"; so is a file
// document_service no longer holds for A — the seam refusing the wrong owner reads the same.
func TestWarehouseTransferLabelPhoto_NoPhotoIsSaid(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakePhotoLinker{owners: map[string]uint64{"doc-not-a": lpReceiver}}
	svc := photoService(db, linker)

	for name, document := range map[string]string{"none attached": "", "the file is not A's": "doc-not-a"} {
		transfer := insertLabelTransfer(t, db, document)

		res, err := transferLabelPhoto(svc, lpReceiver, transfer)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition || res != nil {
			t.Fatalf("%s: %v, %v — want FailedPrecondition", name, res, err)
		}

		var cerr *connect.Error
		if !errors.As(err, &cerr) || cerr.Message() != "this transfer has no label photo" {
			t.Fatalf("%s: message = %v", name, err)
		}
	}

	if !slices.Equal(linker.asked, []string{"doc-not-a"}) {
		t.Fatalf("asked = %v, want only the attached file", linker.asked)
	}
}

// A document_service failure that is not "not there" is the call's error, never a quiet "no photo"; an unwired server
// says Unimplemented.
func TestWarehouseTransferLabelPhoto_ALinkerFailureIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := photoService(db, &fakePhotoLinker{err: connect.NewError(connect.CodeUnavailable, errors.New("down"))})

	transfer := insertLabelTransfer(t, db, "doc-transfer")

	_, err := transferLabelPhoto(svc, lpSeller, transfer)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}

	_, err = transferLabelPhoto(photoService(db, nil), lpSeller, transfer)
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no linker: %v, want Unimplemented", err)
	}
}

// Who may ask: every role of all three sides, and Root and the Administrator — the roles Detail already serves. A read:
// an agent and the monitor may call it.
func TestWarehouseTransferLabelPhoto_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.WarehouseTransferLabelPhotoRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("WarehouseTransferLabelPhotoRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v", policy.GetRoles(), want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName(
		"warehouse.inventory.v1.WarehouseTransferService.WarehouseTransferLabelPhoto")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("WarehouseTransferLabelPhoto must be marked NO_SIDE_EFFECTS")
	}
}
