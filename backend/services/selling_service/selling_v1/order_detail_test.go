package selling_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE DETAIL READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): the order Root placed from outside team 2
// says so on the order and on every timeline row it opened, so the screen draws the "by Root team" badge beside the
// person; the order team 2's own CS placed says neither.
func TestOrderDetail_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	for _, c := range []struct {
		name   string
		userID uint64
		want   bool
	}{
		{"root outside team 2", 1, true},
		{"team 2's own CS", 7, false},
	} {
		role := sellingCS
		if c.want {
			role = rootOutside
		}

		req := orderReq(shopID)
		req.Note = "handle with care"

		created, err := svc.OrderCreate(asScoped(c.userID, 2, role), connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s: OrderCreate: %v", c.name, err)
		}

		got, err := svc.OrderDetail(asScoped(7, 2, sellingCS), connect.NewRequest(&sellingv1.OrderDetailRequest{
			TeamId:  2,
			OrderId: created.Msg.GetOrder().GetId(),
		}))
		if err != nil {
			t.Fatalf("%s: OrderDetail: %v", c.name, err)
		}

		order := got.Msg.GetOrder()
		if order.GetIsOverride() != c.want {
			t.Errorf("%s: order is_override = %v, want %v", c.name, order.GetIsOverride(), c.want)
		}

		if len(order.GetTimelineLogs()) != 2 {
			t.Fatalf("%s: %d timeline rows, want 2 (placed, the note)", c.name, len(order.GetTimelineLogs()))
		}

		for _, log := range order.GetTimelineLogs() {
			if log.GetIsOverride() != c.want {
				t.Errorf("%s: timeline row %d is_override = %v, want %v", c.name, log.GetId(), log.GetIsOverride(), c.want)
			}
		}
	}
}
