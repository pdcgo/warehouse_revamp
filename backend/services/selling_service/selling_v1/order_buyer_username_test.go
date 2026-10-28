package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE BUYER'S USERNAME IS OPTIONAL AND KEPT TRIMMED (the-buyers-username-is-optional): stored without its spaces, spaces
// alone stored as none, and an order with none is placed like any other — on the response and on the detail.
func TestOrderCreate_KeepsTheBuyersUsernameTrimmedAndNeverRequiresIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	cases := []struct {
		name  string
		typed string
		want  string
	}{
		{name: "typed", typed: "  budi.melati  ", want: "budi.melati"},
		{name: "spaces alone", typed: "   ", want: ""},
		{name: "empty", typed: "", want: ""},
	}

	for _, tc := range cases {
		req := feeOrderReq(shop)
		req.BuyerUsername = tc.typed

		created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s: create: %v — the username is never a reason to refuse", tc.name, err)
		}

		if got := created.Msg.GetOrder().GetBuyerUsername(); got != tc.want {
			t.Fatalf("%s: response username = %q, want %q", tc.name, got, tc.want)
		}

		detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
			TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
		}))
		if err != nil {
			t.Fatalf("%s: detail: %v", tc.name, err)
		}

		if got := detail.Msg.GetOrder().GetBuyerUsername(); got != tc.want {
			t.Fatalf("%s: detail username = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// THE APP'S USERNAME YIELDS TO A PERSON'S (§6.5): a push stores it trimmed; a person's edit stores it trimmed and marks
// it touched; the app's next push leaves the person's alone. Before anybody touches it, a re-push follows the app.
func TestOrderDraft_TheBuyersUsernameIsPushedEditedAndYields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := scrape()
	first.BuyerUsername = " budi.scraped "

	draft := push(t, svc, 7, first).GetDraft()
	if draft.GetBuyerUsername() != "budi.scraped" {
		t.Fatalf("pushed username = %q, want it trimmed", draft.GetBuyerUsername())
	}

	second := scrape()
	second.BuyerUsername = "budi.rescraped"

	if got := push(t, svc, 7, second).GetDraft().GetBuyerUsername(); got != "budi.rescraped" {
		t.Fatalf("re-pushed username = %q — an untouched field follows the app's latest reading", got)
	}

	edited := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), BuyerUsername: str("  budi.melati "),
	})
	if edited.GetBuyerUsername() != "budi.melati" {
		t.Fatalf("edited username = %q, want it trimmed", edited.GetBuyerUsername())
	}

	if !contains(edited.GetTouchedFields(), "buyer_username") {
		t.Fatalf("touched %v — the edited username must be marked", edited.GetTouchedFields())
	}

	again := scrape()
	again.BuyerUsername = "somebody.else"

	if got := push(t, svc, 7, again).GetDraft().GetBuyerUsername(); got != "budi.melati" {
		t.Fatalf("username = %q after a re-push — the person's must stand", got)
	}

	// Spaces alone clear it, and it stays claimed.
	cleared := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), BuyerUsername: str("   "),
	})
	if cleared.GetBuyerUsername() != "" || !contains(cleared.GetTouchedFields(), "buyer_username") {
		t.Fatalf("cleared username = %q, touched %v — want none, still marked", cleared.GetBuyerUsername(),
			cleared.GetTouchedFields())
	}
}

// PROMOTE COPIES IT, and a draft without one promotes all the same — empty never refuses, on either door.
func TestOrderDraftPromote_CopiesTheBuyersUsernameAndNeverRequiresIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	withName := readyDraft(t, svc, db, shop)
	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: withName, BuyerUsername: str("budi.melati"),
	})

	order, err := promote(t, svc, 7, 2, withName)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	if order.GetBuyerUsername() != "budi.melati" {
		t.Fatalf("promoted username = %q, want the draft's budi.melati", order.GetBuyerUsername())
	}

	without := readyDraft(t, svc, db, shop)

	order, err = promote(t, svc, 7, 2, without)
	if err != nil {
		t.Fatalf("promote without a username: %v — it is optional", err)
	}

	if order.GetBuyerUsername() != "" {
		t.Fatalf("promoted username = %q on a draft with none — want empty", order.GetBuyerUsername())
	}
}
