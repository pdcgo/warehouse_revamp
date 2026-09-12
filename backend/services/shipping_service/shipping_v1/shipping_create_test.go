package shipping_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A new courier lands active, with the code and name it was given.
func TestShippingCreate_CreatesActiveCourier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ShippingCreate(context.Background(), connect.NewRequest(&shippingv1.ShippingCreateRequest{
		Code: "e2e-anteraja", Name: "AnterAja",
	}))
	if err != nil {
		t.Fatalf("ShippingCreate: %v", err)
	}

	got := resp.Msg.GetShipping()
	if got.GetId() == 0 {
		t.Fatalf("expected a persisted id, got %+v", got)
	}
	if got.GetCode() != "e2e-anteraja" || got.GetName() != "AnterAja" || !got.GetActive() {
		t.Fatalf("unexpected courier: %+v", got)
	}
}

// `code` is unique — a second courier with the same code is AlreadyExists. The migration already
// seeds couriers, so a unique new code avoids colliding with the seed.
func TestShippingCreate_DuplicateCodeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[shippingv1.ShippingCreateRequest] {
		return connect.NewRequest(&shippingv1.ShippingCreateRequest{Code: "e2e-dup", Name: "Dup Courier"})
	}

	_, err := svc.ShippingCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.ShippingCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}
