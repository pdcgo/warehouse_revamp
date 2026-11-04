package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): Root or the
// Administrator writing inside a team they hold no role in is recorded as such on the row that records the act — the
// ledger transaction, a restock's trail row, a transfer's trail row. A member's write of the same act is not.

const ovRoot = uint64(900)

// ctxAs is a request as the access interceptor leaves it: who, the team the request was scoped to, and their role
// there. ROLE_UNSPECIFIED is Root or the Administrator in by the root-team bypass.
func ctxAs(userID, scope uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, scope)

	return san_auth.WithCallerRole(ctx, role)
}

// lastTransactionOverride is the newest ledger transaction of a type: its actor and whether it was an override.
func lastTransactionOverride(t *testing.T, db *gorm.DB, txType string) (actor uint64, override bool) {
	t.Helper()

	var row struct {
		CreateByUserID uint64
		IsOverride     bool
	}

	err := db.Raw(`SELECT create_by_user_id, is_override FROM inventory_transactions WHERE tx_type = ? ORDER BY id DESC LIMIT 1`,
		txType).Scan(&row).Error
	if err != nil {
		t.Fatalf("read %s transaction: %v", txType, err)
	}

	return row.CreateByUserID, row.IsOverride
}

// trailOverrides is a trail's is_override column, oldest row first.
func trailOverrides(t *testing.T, db *gorm.DB, table, key string, id uint64) []bool {
	t.Helper()

	var out []bool

	err := db.Raw(`SELECT is_override FROM `+table+` WHERE `+key+` = ? ORDER BY id`, id).Scan(&out).Error
	if err != nil {
		t.Fatalf("read %s: %v", table, err)
	}

	return out
}

// restockAs raises a restock of Kaos Hitam for Melati at Gudang 5 as `creator`, and accepts it onto `rack` as `accepter`.
func restockAs(t *testing.T, svc *inventory_v1.Service, creator, accepter context.Context, rack uint64) uint64 {
	t.Helper()

	created, err := svc.RestockRequestCreate(creator, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: otWarehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: otKaosHitam, ProductCode: "KH-001", Name: "Kaos Hitam", Count: 2, Total: 20000}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(accepter, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: otWarehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: 2,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: 2}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}

	return r.GetId()
}

// A RESTOCK: each act's trail row says whether THAT act was an override, and the stock-in transaction says it of the
// accept that wrote it — Root raising the request for a seller they are not in, then the warehouse's own staff
// counting it in, and the other way round.
func TestOverride_RestockTrailAndTransaction(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	rootInSeller := ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_UNSPECIFIED)
	rootInWarehouse := ctxAs(ovRoot, otWarehouse, role_basev1.Role_ROLE_UNSPECIFIED)
	seller := ctxAs(8, otMelati, role_basev1.Role_ROLE_SELLING_ADMIN)
	staff := ctxAs(31, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	// Root raises it, staff count it in.
	first := restockAs(t, svc, rootInSeller, staff, rack)

	got := trailOverrides(t, db, "restock_logs", "restock_id", first)
	if len(got) != 2 || !got[0] || got[1] {
		t.Fatalf("restock %d trail overrides = %v, want [true false] — Root's create, the staff's accept", first, got)
	}

	actor, override := lastTransactionOverride(t, db, "restock")
	if actor != 31 || override {
		t.Fatalf("stock-in by %d override %v, want the staff's, not an override", actor, override)
	}

	// The seller raises it, Root counts it in.
	second := restockAs(t, svc, seller, rootInWarehouse, rack)

	got = trailOverrides(t, db, "restock_logs", "restock_id", second)
	if len(got) != 2 || got[0] || !got[1] {
		t.Fatalf("restock %d trail overrides = %v, want [false true] — the seller's create, Root's accept", second, got)
	}

	actor, override = lastTransactionOverride(t, db, "restock")
	if actor != ovRoot || !override {
		t.Fatalf("stock-in by %d override %v, want Root's, an override", actor, override)
	}
}

// A ROOT WHO IS A MEMBER OF THE TEAM acts as that member — only the bypass is an override.
func TestOverride_RootWhoIsAMemberIsNotAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	rootMember := ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_ROOT)
	staff := ctxAs(31, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	id := restockAs(t, svc, rootMember, staff, rack)

	got := trailOverrides(t, db, "restock_logs", "restock_id", id)
	if len(got) != 2 || got[0] || got[1] {
		t.Fatalf("restock %d trail overrides = %v, want [false false]", id, got)
	}
}

// A WAREHOUSE TRANSFER: Root opening one for a seller they are not in stamps the trail's first row and the out-leg; the
// warehouse's own staff processing it stamp nothing.
func TestOverride_WarehouseTransferTrailAndOutLeg(t *testing.T) {
	f := wtStocked(t)

	res, err := f.svc.WarehouseTransferCreate(ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_UNSPECIFIED),
		connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1)},
		}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := res.Msg.GetTransfer().GetId()

	actor, override := lastTransactionOverride(t, f.db, "transfer_out")
	if actor != ovRoot || !override {
		t.Fatalf("out-leg by %d override %v, want Root's, an override", actor, override)
	}

	_, err = f.svc.WarehouseTransferProcess(ctxAs(wtStaffA, wtA, role_basev1.Role_ROLE_WAREHOUSE_STAFF),
		connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{TeamId: wtA, TransferId: id}))
	if err != nil {
		t.Fatalf("process: %v", err)
	}

	got := trailOverrides(t, f.db, "warehouse_transfer_logs", "transfer_id", id)
	if len(got) != 2 || !got[0] || got[1] {
		t.Fatalf("transfer %d trail overrides = %v, want [true false] — Root's create, the staff's process", id, got)
	}

	// The seller's own create is not an override, on either row.
	res, err = f.svc.WarehouseTransferCreate(ctxAs(wtSeller, otMelati, role_basev1.Role_ROLE_SELLING_ADMIN),
		connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosPolos, 1)},
		}))
	if err != nil {
		t.Fatalf("seller's create: %v", err)
	}

	actor, override = lastTransactionOverride(t, f.db, "transfer_out")
	if actor != wtSeller || override {
		t.Fatalf("out-leg by %d override %v, want the seller's, not an override", actor, override)
	}

	got = trailOverrides(t, f.db, "warehouse_transfer_logs", "transfer_id", res.Msg.GetTransfer().GetId())
	if len(got) != 1 || got[0] {
		t.Fatalf("seller's transfer trail overrides = %v, want [false]", got)
	}
}

// A CALL WITH NO SCOPE — a direct domain call, as every older test makes — is never stamped.
func TestOverride_UnscopedCallIsNotAnOverride(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	_, err := take(svc, "key-1", &inventoryv1.OrderTransactionLine{ProductId: otKaosHitam, Quantity: 1})
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	_, override := lastTransactionOverride(t, db, "order")
	if override {
		t.Fatal("an unscoped take was stamped an override")
	}
}

// THE ACCEPT'S STAMP TRAVELS ON ITS EVENT: RestockAccepted carries `actor_is_override` from the accept's own trail row,
// so the courier charge liability posts from it says who counted the box in from outside — and the backfill, which
// builds the same event from what the accept stored, reads the same answer.
func TestOverride_RestockAcceptedCarriesTheAcceptsStamp(t *testing.T) {
	db := san_testdb.DB(t)
	sender := &recordingSender{}
	svc := newAcceptService(db, sender)
	staging := stagingPlacement(t, db, acceptWarehouse)

	for _, c := range []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"Root outside the warehouse", ctxAs(ovRoot, acceptWarehouse, role_basev1.Role_ROLE_UNSPECIFIED), true},
		{"the warehouse's own staff", ctxAs(31, acceptWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), false},
	} {
		req := createTwoLines(t, svc)
		sender.sent = nil

		_, err := svc.RestockRequestAccept(c.ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: acceptWarehouse, RequestId: req.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{
				{ItemId: req.GetItems()[0].GetId(), ReceivedCount: 10, Placements: placedOn(staging, 10)},
				{ItemId: req.GetItems()[1].GetId(), ReceivedCount: 5, Placements: placedOn(staging, 5)},
			},
		}))
		if err != nil {
			t.Fatalf("%s: accept: %v", c.name, err)
		}

		if len(sender.sent) != 1 || sender.sent[0].GetRestockAccepted() == nil {
			t.Fatalf("%s: published %v, want one RestockAccepted", c.name, sender.sent)
		}

		published := sender.sent[0].GetRestockAccepted()
		if published.GetActorIsOverride() != c.want {
			t.Errorf("%s: published actor_is_override = %v, want %v", c.name, published.GetActorIsOverride(), c.want)
		}

		var stored []inventory_service_models.Restock

		err = inventory_v1.AcceptedRestocks(db).Where("restocks.id = ?", req.GetId()).Find(&stored).Error
		if err != nil || len(stored) != 1 {
			t.Fatalf("%s: read the accepted restock back: %v (%d rows)", c.name, err, len(stored))
		}

		rebuilt := inventory_v1.RestockAcceptedEvent(&stored[0]).GetRestockAccepted()
		if rebuilt.GetActorIsOverride() != c.want {
			t.Errorf("%s: the backfill's actor_is_override = %v, want %v — the same event from the stored rows",
				c.name, rebuilt.GetActorIsOverride(), c.want)
		}
	}
}
