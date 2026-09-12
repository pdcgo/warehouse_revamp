package shipping_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_service_models"
)

// The migration seeds the courier catalogue, so a fresh DB already lists them.
func TestShippingList_ReturnsSeededCouriers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ShippingList(context.Background(), connect.NewRequest(&shippingv1.ShippingListRequest{}))
	if err != nil {
		t.Fatalf("ShippingList: %v", err)
	}

	data := resp.Msg.GetData()
	if len(data) == 0 {
		t.Fatal("ShippingList returned no couriers — the seed did not run")
	}

	// Alphabetical by name, and a well-known courier is present.
	var foundJNE bool
	for i, s := range data {
		if s.GetCode() == "" || s.GetName() == "" {
			t.Errorf("courier %d has empty code/name: %+v", i, s)
		}
		if i > 0 && data[i-1].GetName() > s.GetName() {
			t.Errorf("not sorted by name at %d: %q before %q", i, data[i-1].GetName(), s.GetName())
		}
		if s.GetCode() == "jne" {
			foundJNE = true
		}
	}

	if !foundJNE {
		t.Error("expected the JNE courier in the seeded list")
	}
}

// include_inactive=false hides retired couriers; true reveals them.
func TestShippingList_ActiveFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Retire one courier.
	err := db.Model(&shipping_service_models.Shipping{}).
		Where("code = ?", "ncs").
		Update("active", false).Error
	if err != nil {
		t.Fatalf("retire courier: %v", err)
	}

	active, err := svc.ShippingList(context.Background(), connect.NewRequest(&shippingv1.ShippingListRequest{}))
	if err != nil {
		t.Fatalf("ShippingList(active): %v", err)
	}
	for _, s := range active.Msg.GetData() {
		if s.GetCode() == "ncs" {
			t.Fatal("retired courier appeared with include_inactive=false")
		}
	}

	all, err := svc.ShippingList(context.Background(), connect.NewRequest(&shippingv1.ShippingListRequest{IncludeInactive: true}))
	if err != nil {
		t.Fatalf("ShippingList(all): %v", err)
	}
	if len(all.Msg.GetData()) <= len(active.Msg.GetData()) {
		t.Fatal("include_inactive=true did not return more couriers than active-only")
	}
}
