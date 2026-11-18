package inventory_v1_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"buf.build/go/protovalidate"
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
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// codPaid is the read under test, sugar for the request.
func codPaid(t *testing.T, svc *inventory_v1.Service, warehouse uint64, from, to time.Time) *inventoryv1.RestockCodPaidStatResponse {
	t.Helper()

	res, err := svc.RestockCodPaidStat(context.Background(), connect.NewRequest(&inventoryv1.RestockCodPaidStatRequest{
		TeamId:   warehouse,
		FromUnix: from.Unix(),
		ToUnix:   to.Unix(),
	}))
	if err != nil {
		t.Fatalf("RestockCodPaidStat: %v", err)
	}

	return res.Msg
}

// seedCodRestock writes a restock row as an accept leaves it — status, when, and the courier's charge — with the
// selling team's own money on it too (goods, freight), which the card must never add in.
func seedCodRestock(t *testing.T, db *gorm.DB, warehouse uint64, status string, acceptedAt *time.Time, charge float64) uint64 {
	t.Helper()

	r := inventory_service_models.Restock{
		TeamID:                      2,
		WarehouseID:                 warehouse,
		Status:                      status,
		ShipmentCost:                25_000,
		Subtotal:                    1_000_000,
		Total:                       1_025_000,
		WarehouseAdditionalCost:     charge,
		WarehouseAdditionalCostNote: courierNote,
		AcceptedAt:                  acceptedAt,
	}

	err := db.Create(&r).Error
	if err != nil {
		t.Fatalf("seed restock: %v", err)
	}

	return r.ID
}

// THE COD THE WAREHOUSE PAID (the-warehouse-sees-the-cod-it-paid): the courier's charge on the restocks IT accepted in
// the window — both ends in — and how many carried one. Not a restock with no charge, not one accepted a second outside
// the window, not another warehouse's, not a box still at the door; and never the selling team's money (goods, freight).
func TestRestockCodPaidStat_SumsTheChargeItPaidInTheWindow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, other uint64 = 5, 6

	jakarta := time.FixedZone("WIB", 7*3600)
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, jakarta)
	to := time.Date(2026, 11, 16, 23, 59, 59, 0, jakarta)
	at := func(t time.Time) *time.Time { return &t }

	seedCodRestock(t, db, warehouse, "accepted", at(from), 15_000)                    // the first second — in
	seedCodRestock(t, db, warehouse, "accepted", at(to), 20_000)                      // the last second — in
	seedCodRestock(t, db, warehouse, "accepted", at(from.Add(48*time.Hour)), 0)       // no charge — not counted
	seedCodRestock(t, db, warehouse, "accepted", at(from.Add(-time.Second)), 30_000)  // last month
	seedCodRestock(t, db, warehouse, "accepted", at(to.Add(time.Second)), 30_000)     // after the window
	seedCodRestock(t, db, other, "accepted", at(from.Add(24*time.Hour)), 40_000)      // another warehouse's
	seedCodRestock(t, db, warehouse, "arrived", at(from.Add(24*time.Hour)), 10_000)   // at the door, not accepted
	seedCodRestock(t, db, warehouse, "cancelled", at(from.Add(24*time.Hour)), 10_000) // never accepted

	// And one through the real accept: the charge is what Terima writes.
	staging := stagingPlacement(t, db, warehouse)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShipmentCost: 80_000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, ProductCode: "KPH-001", Name: "Kaos Polos Hitam", Count: 10, Total: 400_000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	restock := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: restock.GetId(), WarehouseAdditionalCost: 50_000, WarehouseAdditionalCostNote: courierNote,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: restock.GetItems()[0].GetId(), ReceivedCount: 10, Placements: placedOn(staging, 10)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	err = db.Exec("UPDATE restocks SET accepted_at = ? WHERE id = ?", from.Add(72*time.Hour), restock.GetId()).Error
	if err != nil {
		t.Fatalf("date the accept: %v", err)
	}

	got := codPaid(t, svc, warehouse, from, to)
	if got.GetRestockCount() != 3 || got.GetAmount() != 85_000 {
		t.Fatalf("cod = %d restocks · Rp %v, want 3 · Rp 85.000 (15.000 + 20.000 + the accept's 50.000)",
			got.GetRestockCount(), got.GetAmount())
	}

	// The other warehouse reads its own and nothing of this one's.
	if theirs := codPaid(t, svc, other, from, to); theirs.GetRestockCount() != 1 || theirs.GetAmount() != 40_000 {
		t.Fatalf("other warehouse = %+v, want 1 · Rp 40.000", theirs)
	}
}

// A month with nothing paid reads 0 and 0 — not an error, not a NULL scan.
func TestRestockCodPaidStat_NothingPaidIsZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	now := time.Now()
	got := codPaid(t, svc, 5, now.Add(-24*time.Hour), now)
	if got.GetRestockCount() != 0 || got.GetAmount() != 0 {
		t.Fatalf("cod = %+v, want 0 · 0", got)
	}
}

// The window is required and runs forward: both bounds set, the end never before the start.
func TestRestockCodPaidStat_TheWindowIsChecked(t *testing.T) {
	ok := &inventoryv1.RestockCodPaidStatRequest{TeamId: 5, FromUnix: 100, ToUnix: 100}

	err := protovalidate.Validate(ok)
	if err != nil {
		t.Fatalf("a one-second window: %v", err)
	}

	for name, req := range map[string]*inventoryv1.RestockCodPaidStatRequest{
		"no start":         {TeamId: 5, ToUnix: 100},
		"no end":           {TeamId: 5, FromUnix: 100},
		"end before start": {TeamId: 5, FromUnix: 200, ToUnix: 100},
		"no warehouse":     {FromUnix: 100, ToUnix: 200},
	} {
		err = protovalidate.Validate(req)
		if err == nil {
			t.Fatalf("%s: accepted, want refused", name)
		}
	}
}

// Who may ask: RestockInboundStat's readers — the warehouse's three roles, Root and the Administrator; never a selling
// role, whose money this is not. A read: an agent and the monitor may call it.
func TestRestockCodPaidStat_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockCodPaidStatRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("RestockCodPaidStatRequest has no policy")
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

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockCodPaidStat")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockCodPaidStat must be marked NO_SIDE_EFFECTS")
	}
}
