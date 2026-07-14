package shipping_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	shipping_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_v1"
)

// Renaming leaves the code and active flag alone.
func TestShippingUpdate_RenameKeepsCodeAndActive(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created := createCourier(t, svc, "e2e-rename", "Before")

	resp, err := svc.ShippingUpdate(context.Background(), connect.NewRequest(&shippingv1.ShippingUpdateRequest{
		ShippingId: created.GetId(), Name: proto.String("After"),
	}))
	if err != nil {
		t.Fatalf("rename: %v", err)
	}

	got := resp.Msg.GetShipping()
	if got.GetName() != "After" || got.GetCode() != "e2e-rename" || !got.GetActive() {
		t.Fatalf("after rename: %+v", got)
	}
}

// Deactivating (active=false) hides the courier from the default list but keeps it visible with
// include_inactive=true — the row is retired, never deleted.
func TestShippingUpdate_DeactivateHidesFromDefaultList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created := createCourier(t, svc, "e2e-deactivate", "Retiring Courier")

	_, err := svc.ShippingUpdate(context.Background(), connect.NewRequest(&shippingv1.ShippingUpdateRequest{
		ShippingId: created.GetId(), Active: proto.Bool(false),
	}))
	if err != nil {
		t.Fatalf("deactivate: %v", err)
	}

	// Default list (active only) must not contain the retired courier.
	active, err := svc.ShippingList(context.Background(), connect.NewRequest(&shippingv1.ShippingListRequest{}))
	if err != nil {
		t.Fatalf("ShippingList(active): %v", err)
	}
	if containsCode(active.Msg.GetData(), "e2e-deactivate") {
		t.Fatal("retired courier appeared in the default (active-only) list")
	}

	// include_inactive=true must still surface it — and as inactive.
	all, err := svc.ShippingList(context.Background(), connect.NewRequest(&shippingv1.ShippingListRequest{IncludeInactive: true}))
	if err != nil {
		t.Fatalf("ShippingList(all): %v", err)
	}
	var found *shippingv1.Shipping
	for _, s := range all.Msg.GetData() {
		if s.GetCode() == "e2e-deactivate" {
			found = s
		}
	}
	if found == nil {
		t.Fatal("retired courier missing from include_inactive=true list")
	}
	if found.GetActive() {
		t.Fatalf("retired courier still marked active: %+v", found)
	}

	// And reactivating brings it back to the default list.
	_, err = svc.ShippingUpdate(context.Background(), connect.NewRequest(&shippingv1.ShippingUpdateRequest{
		ShippingId: created.GetId(), Active: proto.Bool(true),
	}))
	if err != nil {
		t.Fatalf("reactivate: %v", err)
	}

	active, err = svc.ShippingList(context.Background(), connect.NewRequest(&shippingv1.ShippingListRequest{}))
	if err != nil {
		t.Fatalf("ShippingList(active) after reactivate: %v", err)
	}
	if !containsCode(active.Msg.GetData(), "e2e-deactivate") {
		t.Fatal("reactivated courier did not return to the default list")
	}
}

func TestShippingUpdate_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShippingUpdate(context.Background(), connect.NewRequest(&shippingv1.ShippingUpdateRequest{
		ShippingId: 999999, Name: proto.String("nobody"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// createCourier makes a courier through the service and returns the created Shipping.
func createCourier(t *testing.T, svc *shipping_v1.Service, code, name string) *shippingv1.Shipping {
	t.Helper()

	resp, err := svc.ShippingCreate(context.Background(), connect.NewRequest(&shippingv1.ShippingCreateRequest{
		Code: code, Name: name,
	}))
	if err != nil {
		t.Fatalf("createCourier(%q): %v", code, err)
	}

	return resp.Msg.GetShipping()
}

func containsCode(data []*shippingv1.Shipping, code string) bool {
	for _, s := range data {
		if s.GetCode() == code {
			return true
		}
	}

	return false
}
