package selling_v1_test

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

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakeLinker is document_service's LabelURL: it signs only the documents it holds, for their owner.
type fakeLinker struct {
	// document id → owner team
	owners map[string]uint64
	asked  []string
	err    error
}

func (f *fakeLinker) LabelURL(_ context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	f.asked = append(f.asked, documentID)

	if f.err != nil {
		return "", time.Time{}, f.err
	}

	if owner, ok := f.owners[documentID]; !ok || owner != ownerTeamID {
		return "", time.Time{}, connect.NewError(connect.CodeNotFound, errors.New("document not found"))
	}

	return "https://files.invalid/" + documentID, time.Unix(1_900_000_000, 0), nil
}

func labelService(db *gorm.DB, linker selling_v1.LabelLinker) *selling_v1.Service {
	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, nil, nil, nil, linker)
}

// insertLabelOrder writes an order of selling team 2 shipping from `warehouse`, with a label file or none.
func insertLabelOrder(t *testing.T, db *gorm.DB, warehouse uint64, documentID string) uint64 {
	t.Helper()

	shop := insertShop(t, db, 2, "Toko Label", "LBL-"+documentID, "shopee")

	order := selling_service_models.Order{
		IdempotencyKey:    newOrderKey(),
		TeamID:            2,
		ShopID:            shop,
		WarehouseID:       warehouse,
		Status:            "processed",
		CustomerName:      "Budi",
		ReceiptDocumentID: documentID,
		ReceiptFilename:   "label.pdf",
		ReceiptMimeType:   "application/pdf",
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	return order.ID
}

func orderLabels(svc *selling_v1.Service, teamID uint64, orderIDs ...uint64) (*sellingv1.OrderLabelsResponse, error) {
	res, err := svc.OrderLabels(context.Background(), connect.NewRequest(&sellingv1.OrderLabelsRequest{
		TeamId:   teamID,
		OrderIds: orderIDs,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// a-warehouse-prints-the-labels-of-orders-it-ships: the warehouse an order ships from gets a link to its label — the
// seller's document, signed for the seller's team as its owner, without any share.
func TestOrderLabels_TheShippingWarehouseGetsTheLink(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{owners: map[string]uint64{"doc-label": 2}}
	svc := labelService(db, linker)

	order := insertLabelOrder(t, db, testWarehouse, "doc-label")

	res, err := orderLabels(svc, testWarehouse, order)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if res.GetUrl() != "https://files.invalid/doc-label" || res.GetExpiresAtUnix() != 1_900_000_000 {
		t.Fatalf("link = %q, expires %d", res.GetUrl(), res.GetExpiresAtUnix())
	}

	if len(res.GetResults()) != 1 || !res.GetResults()[0].GetIncluded() || res.GetResults()[0].GetOrderId() != order ||
		res.GetResults()[0].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNSPECIFIED {
		t.Fatalf("results = %v", res.GetResults())
	}

	// The root team opens any order's label.
	root, err := orderLabels(svc, san_auth.RootTeamID, order)
	if err != nil || !root.GetResults()[0].GetIncluded() {
		t.Fatalf("root: %v, %v", root, err)
	}
}

// Another warehouse is refused — NOT_SHIPPED_HERE, the same answer as an id that does not exist, and document_service
// is never asked.
func TestOrderLabels_AnotherWarehouseIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{owners: map[string]uint64{"doc-label": 2}}
	svc := labelService(db, linker)

	order := insertLabelOrder(t, db, testWarehouse, "doc-label")

	for name, id := range map[string]uint64{"another warehouse's order": order, "no such order": order + 10_000} {
		res, err := orderLabels(svc, testWarehouse+1, id)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		got := res.GetResults()[0]
		if got.GetIncluded() || got.GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE ||
			res.GetUrl() != "" || res.GetExpiresAtUnix() != 0 {
			t.Fatalf("%s: %v", name, res)
		}
	}

	if len(linker.asked) != 0 {
		t.Fatalf("document_service was asked for %v before the check passed", linker.asked)
	}
}

// An order with no label attached is NO_LABEL; so is one whose file document_service no longer holds for the seller.
func TestOrderLabels_NoLabelIsSaid(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{owners: map[string]uint64{"doc-other-team": 3}}
	svc := labelService(db, linker)

	for name, document := range map[string]string{"none attached": "", "the file is not the seller's": "doc-other-team"} {
		order := insertLabelOrder(t, db, testWarehouse, document)

		res, err := orderLabels(svc, testWarehouse, order)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		got := res.GetResults()[0]
		if got.GetIncluded() || got.GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL || res.GetUrl() != "" {
			t.Fatalf("%s: %v", name, res)
		}
	}
}

// A document_service failure that is not "not there" is the call's error, never a quiet NO_LABEL.
func TestOrderLabels_ALinkerFailureIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := labelService(db, &fakeLinker{err: connect.NewError(connect.CodeUnavailable, errors.New("down"))})

	order := insertLabelOrder(t, db, testWarehouse, "doc-label")

	_, err := orderLabels(svc, testWarehouse, order)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}

	if _, err = orderLabels(labelService(db, nil), testWarehouse, order); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no linker: %v, want Unimplemented", err)
	}
}

// Who may ask: the warehouse's three roles and Root and the Administrator — never a selling role, who keeps reading its
// own labels with GetDownloadUrl. A read: an agent and the monitor may call it.
func TestOrderLabels_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderLabelsRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("OrderLabelsRequest has no policy")
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

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderService.OrderLabels")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("OrderLabels must be marked NO_SIDE_EFFECTS")
	}
}
