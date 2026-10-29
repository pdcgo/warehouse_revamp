package selling_v1_test

import (
	"testing"

	"buf.build/go/protovalidate"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderCreate refuses an order with no marketplace ref (an-order-ref-is-required-by-the-rpc). The rule lives on the
// proto (buf.validate min_len 1) and is enforced by the protovalidate interceptor before the handler runs — this
// asserts the contract directly, so the gate can't silently regress back to "" meaning a phone order.
func TestOrderCreateRequest_RefIsRequired(t *testing.T) {
	v, err := protovalidate.New()
	if err != nil {
		t.Fatalf("protovalidate.New: %v", err)
	}

	// Only the ref varies; everything else is the smallest request the contract accepts.
	req := func(ref string) *sellingv1.OrderCreateRequest {
		return &sellingv1.OrderCreateRequest{
			TeamId:             12,
			ShopId:             21,
			WarehouseId:        11,
			CustomerName:       "Bu Lestari",
			OrderExternalRefId: ref,
			Items:              []*sellingv1.OrderItem{{ProductId: 77, Sku: "TS-01", Name: "Kaos Polos", Quantity: 1}},
		}
	}

	err = v.Validate(req("MEL-9001"))
	if err != nil {
		t.Fatalf("a request with a ref was rejected: %v", err)
	}

	err = v.Validate(req(""))
	if err == nil {
		t.Errorf("a request with no ref was accepted, want rejected")
	}
}
