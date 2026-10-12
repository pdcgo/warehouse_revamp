package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// The pushing app authenticates as a real person (§6.3), so every test here says who is pushing —
// there is no such thing as an anonymous draft.
func asUser(userID uint64) context.Context {
	return san_auth.WithIdentity(context.Background(),
		&role_basev1.Identity{IdentityId: userID})
}

func push(
	t *testing.T,
	svc *selling_v1.Service,
	userID uint64,
	req *sellingv1.OrderDraftPushRequest,
) *sellingv1.OrderDraftPushResponse {
	t.Helper()

	res, err := svc.OrderDraftPush(asUser(userID), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("OrderDraftPush(%s/%s): %v", req.GetSource(), req.GetExternalId(), err)
	}

	return res.Msg
}

// scrape is a plausible push from the app: a customer, an address, and two lines it could only read
// as marketplace text.
func scrape() *sellingv1.OrderDraftPushRequest {
	return &sellingv1.OrderDraftPushRequest{
		TeamId:       2,
		Source:       "scraper-app",
		ExternalId:   "SHP-100",
		CustomerName: "Budi",
		Address:      &sellingv1.OrderAddress{ProvinsiName: "Jawa Barat", AddressLine: "Jl. Merdeka 1"},
		ShippingCost: 15000,
		Items: []*sellingv1.OrderDraftItem{
			{ExternalSku: "MP-1", ExternalName: "Kaos Polos Hitam L", Quantity: 2, UnitPrice: 50000},
			{ExternalSku: "MP-2", ExternalName: "Topi Baseball", Quantity: 1, UnitPrice: 35000},
		},
	}
}

// markTouched is what OrderDraftUpdate (#193) will do — written directly here so this issue's merge
// rule can be tested before that RPC exists.
func markTouched(t *testing.T, db *gorm.DB, draftID uint64, fields string) {
	t.Helper()

	err := db.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", draftID).
		Update("touched_fields", fields).
		Error
	if err != nil {
		t.Fatalf("mark touched: %v", err)
	}
}

// The base case: a scrape arrives and becomes a draft, keeping the marketplace's text verbatim and
// mapping nothing.
func TestOrderDraftPush_CreatesADraftFromScrapedText(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	msg := push(t, svc, 7, scrape())

	if !msg.GetCreated() {
		t.Fatal("first push reported created=false — the caller cannot tell a new scrape from a retry")
	}

	draft := msg.GetDraft()
	if draft.GetAuthorUserId() != 7 {
		t.Fatalf("author = %d, want 7 (the login the app runs under)", draft.GetAuthorUserId())
	}

	if len(draft.GetItems()) != 2 {
		t.Fatalf("items = %d, want 2", len(draft.GetItems()))
	}

	first := draft.GetItems()[0]
	if first.GetExternalName() != "Kaos Polos Hitam L" {
		t.Fatalf("external_name = %q — the evidence of what was ordered must survive verbatim",
			first.GetExternalName())
	}

	// The unmapped line IS what makes this a draft (§6.4). A push that arrived already mapped would
	// mean a client had guessed at our catalogue.
	if first.GetProductId() != 0 {
		t.Fatalf("product_id = %d on a fresh scrape, want 0 — mapping is a human act",
			first.GetProductId())
	}
}

// THE POINT OF THE DEDUPE KEY (§6.5). A retry after a flaky connection must land on the same draft;
// without this, one bad network fills the list with near-identical drafts nobody can tell apart.
func TestOrderDraftPush_IsIdempotentOnTheExternalRef(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := push(t, svc, 7, scrape())
	second := push(t, svc, 7, scrape())

	if second.GetCreated() {
		t.Fatal("a re-push reported created=true — the retry made a second draft")
	}

	if second.GetDraft().GetId() != first.GetDraft().GetId() {
		t.Fatalf("re-push produced draft %d, want the existing %d",
			second.GetDraft().GetId(), first.GetDraft().GetId())
	}

	var count int64

	err := db.Model(&selling_service_models.OrderDraft{}).Count(&count).Error
	if err != nil {
		t.Fatalf("count drafts: %v", err)
	}

	if count != 1 {
		t.Fatalf("%d drafts in the table after two pushes of one scrape, want 1", count)
	}

	// The lines are replaced, not appended — an idempotent push that doubled the lines every retry
	// would be the same duplication bug one level down.
	if len(second.GetDraft().GetItems()) != 2 {
		t.Fatalf("items = %d after the re-push, want 2", len(second.GetDraft().GetItems()))
	}
}

// THE MERGE RULE, and the substance of #191: a re-scrape may fill blanks and may NOT overwrite work
// a person has done. Without it, a background push silently destroys ten minutes of mapping.
func TestOrderDraftPush_LeavesTouchedFieldsAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created := push(t, svc, 7, scrape())
	draftID := created.GetDraft().GetId()

	// A person corrected the customer and mapped the lines.
	markTouched(t, db, draftID, `["customer_name","items"]`)

	err := db.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", draftID).
		Update("customer_name", "Budi Santoso").
		Error
	if err != nil {
		t.Fatalf("apply the human edit: %v", err)
	}

	err = db.
		Model(&selling_service_models.OrderDraftItem{}).
		Where("draft_id = ? AND external_sku = ?", draftID, "MP-1").
		Update("product_id", 42).
		Error
	if err != nil {
		t.Fatalf("apply the mapping: %v", err)
	}

	// The app re-scrapes, and disagrees about everything.
	repush := scrape()
	repush.CustomerName = "budi"
	repush.ShippingCost = 21000
	repush.Items = []*sellingv1.OrderDraftItem{
		{ExternalSku: "MP-9", ExternalName: "Something Else", Quantity: 5, UnitPrice: 1000},
	}

	draft := push(t, svc, 7, repush).GetDraft()

	if draft.GetCustomerName() != "Budi Santoso" {
		t.Fatalf("customer_name = %q — the re-push overwrote a touched field", draft.GetCustomerName())
	}

	if len(draft.GetItems()) != 2 {
		t.Fatalf("items = %d, want the 2 the person mapped — the re-push rewrote touched lines",
			len(draft.GetItems()))
	}

	var mapped uint64

	for _, item := range draft.GetItems() {
		if item.GetExternalSku() == "MP-1" {
			mapped = item.GetProductId()
		}
	}

	if mapped != 42 {
		t.Fatalf("product_id on MP-1 = %d, want 42 — the mapping was destroyed", mapped)
	}

	// …and the untouched field DID move. "Blanks only" is a rule about touched fields, not about
	// empty ones: the app is still the authority on everything nobody here has claimed.
	if draft.GetShippingCost() != 21000 {
		t.Fatalf("shipping_cost = %d, want 21000 — an untouched field must still follow the app",
			draft.GetShippingCost())
	}
}

// The address is ONE touched field, not ten columns. Somebody who fixes a kecamatan has fixed the
// address, and a re-scrape rewriting the columns around their fix would leave a hybrid address that
// was never true anywhere.
func TestOrderDraftPush_TheAddressIsTouchedWhole(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := push(t, svc, 7, scrape()).GetDraft().GetId()
	markTouched(t, db, draftID, `["address"]`)

	repush := scrape()
	repush.Address = &sellingv1.OrderAddress{ProvinsiName: "Bali", AddressLine: "Jl. Sunset 9"}

	draft := push(t, svc, 7, repush).GetDraft()

	if draft.GetAddress().GetProvinsiName() != "Jawa Barat" ||
		draft.GetAddress().GetAddressLine() != "Jl. Merdeka 1" {
		t.Fatalf("address = %q / %q — a touched address was partly rewritten",
			draft.GetAddress().GetProvinsiName(), draft.GetAddress().GetAddressLine())
	}
}

// The same external ref pushed under a different login HANDS THE DRAFT OVER (§6.3). A draft is
// personal, so re-pushing is the only way to move one — this is the escape hatch "personal" leans on
// rather than an accident.
func TestOrderDraftPush_ReassignsTheAuthor(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	push(t, svc, 7, scrape())
	draft := push(t, svc, 9, scrape()).GetDraft()

	if draft.GetAuthorUserId() != 9 {
		t.Fatalf("author = %d after a re-push by user 9, want 9", draft.GetAuthorUserId())
	}
}

// A draft with no author would be pushed successfully and then appear in nobody's list, since the
// list narrows to the author. Refusing is the honest answer.
func TestOrderDraftPush_RefusesWithoutAnIdentity(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.OrderDraftPush(context.Background(), connect.NewRequest(scrape()))
	if err == nil {
		t.Fatal("an anonymous push succeeded — the draft would belong to nobody")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

// Two teams scraping the same marketplace order are two different drafts — the dedupe key is per
// team, so one team's scrape can never merge into another's.
func TestOrderDraftPush_TheDedupeKeyIsPerTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := push(t, svc, 7, scrape())

	other := scrape()
	other.TeamId = 3

	second := push(t, svc, 7, other)

	if !second.GetCreated() || second.GetDraft().GetId() == first.GetDraft().GetId() {
		t.Fatal("another team's push landed on the first team's draft")
	}
}
