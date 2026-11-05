package selling_v1_test

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// pushDraftOn is one scrape: a draft of `teamID` in `shopID` on marketplace ref `ref`, pushed by `userID` from `source`.
func pushDraftOn(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID, shopID uint64,
	source, ref string,
) uint64 {
	t.Helper()

	msg := scrape()
	msg.TeamId = teamID
	msg.ShopId = shopID
	msg.Source = source
	msg.ExternalId = ref

	res, err := svc.OrderDraftPush(asUser(userID), connect.NewRequest(msg))
	if err != nil {
		t.Fatalf("OrderDraftPush(%s/%s): %v", source, ref, err)
	}

	return res.Msg.GetDraft().GetId()
}

// The duplicate-ref warning's draft half: every draft of the TEAM in the asked shop on an asked ref — any author's,
// any app's — and nothing else: not another shop's, not another team's, not a manual draft (its external id is a
// minted form id), and a ref no draft carries is absent.
func TestOrderDraftByExternalRefs_FindsTheTeamsDraftsInTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const team uint64 = 2

	// Real shops: a push names a shop it writes on (a-write-needs-a-grant-or-a-manager), so each must exist in its team.
	shop := insertShop(t, db, team, "Ref Shop", "RS1", "shopee")
	otherShop := insertShop(t, db, team, "Ref Other", "RS2", "shopee")
	otherTeams := insertShop(t, db, 3, "Ref Team 3", "RS3", "shopee")

	mine := pushDraftOn(t, svc, 7, team, shop, "scraper-app", "SHP-1")
	colleagues := pushDraftOn(t, svc, 8, team, shop, "other-app", "SHP-1")
	pushDraftOn(t, svc, 7, team, otherShop, "scraper-app", "SHP-2") // another shop — not this order's double
	pushDraftOn(t, svc, 50, 3, otherTeams, "scraper-app", "SHP-1")  // another team — never answered
	pushDraftOn(t, svc, 7, team, shop, "manual", "SHP-3")           // a form-saved draft — its id is no ref
	second := pushDraftOn(t, svc, 9, team, shop, "scraper-app", "SHP-4")

	// A fixed creation time, so the answer's date is provably the row's.
	at := time.Date(2026, 11, 3, 9, 30, 0, 0, time.UTC)

	err := db.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", second).
		Update("created_at", at).
		Error
	if err != nil {
		t.Fatalf("stamp created_at: %v", err)
	}

	resp, err := svc.OrderDraftByExternalRefs(asUser(7), connect.NewRequest(&sellingv1.OrderDraftByExternalRefsRequest{
		TeamId: team,
		Filter: &sellingv1.OrderDraftByExternalRefsFilter{
			ShopId: shop,
			Refs:   []string{"SHP-1", "SHP-2", "SHP-3", "SHP-4", "SHP-9"},
		},
	}))
	if err != nil {
		t.Fatalf("OrderDraftByExternalRefs: %v", err)
	}

	found := func(ref string) map[uint64]*sellingv1.OrderDraftRefItem {
		list := resp.Msg.GetItems()[ref]
		if list == nil || len(list.GetItems()) != 1 {
			return nil
		}

		return list.GetItems()[0].GetDraftRef().GetMapData()
	}

	one := found("SHP-1")
	if len(one) != 2 || one[mine] == nil || one[colleagues] == nil {
		t.Fatalf("SHP-1 = %v, want drafts %d and %d — the colleague's too, never the other team's", one, mine, colleagues)
	}

	if one[colleagues].GetAuthorUserId() != 8 || one[colleagues].GetShopId() != shop {
		t.Errorf("SHP-1 colleague's draft = %+v", one[colleagues])
	}

	four := found("SHP-4")
	if len(four) != 1 || four[second].GetCreatedAtUnix() != at.Unix() {
		t.Fatalf("SHP-4 = %v, want draft %d created at %d", four, second, at.Unix())
	}

	for _, ref := range []string{"SHP-2", "SHP-3", "SHP-9"} {
		if _, ok := resp.Msg.GetItems()[ref]; ok {
			t.Errorf("%s must be ABSENT (another shop, a manual draft, or no draft at all)", ref)
		}
	}
}

// Nothing on the refs → an empty map, not an error.
func TestOrderDraftByExternalRefs_NothingFoundIsEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.OrderDraftByExternalRefs(asUser(7), connect.NewRequest(&sellingv1.OrderDraftByExternalRefsRequest{
		TeamId: 2,
		Filter: &sellingv1.OrderDraftByExternalRefsFilter{ShopId: 31, Refs: []string{"NOBODY"}},
	}))
	if err != nil {
		t.Fatalf("OrderDraftByExternalRefs: %v", err)
	}

	if len(resp.Msg.GetItems()) != 0 {
		t.Fatalf("items = %v, want none", resp.Msg.GetItems())
	}
}

// Who may ask: the people who may create orders — the warning runs before OrderCreate. A read: an agent and the
// monitor may call it. The refs are bounded (50) and the shop is required.
func TestOrderDraftByExternalRefs_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderDraftByExternalRefsRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("OrderDraftByExternalRefsRequest has no policy")
	}

	create, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderCreateRequest")
	if err != nil {
		t.Fatal(err)
	}

	want := san_auth.PolicyOf(create.(protoreflect.MessageDescriptor)).GetRoles()
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want OrderCreate's %v", policy.GetRoles(), want)
	}

	if !slices.Contains(policy.GetRoles(), role_basev1.Role_ROLE_SELLING_CS) {
		t.Fatal("CS types orders in, so CS must be able to read the warning")
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName(
		"warehouse.selling.v1.OrderDraftService.OrderDraftByExternalRefs")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("OrderDraftByExternalRefs must be marked NO_SIDE_EFFECTS")
	}
}

// The read is bounded: a shop is required, and at most 50 refs — a form asks for one.
func TestOrderDraftByExternalRefsRequest_IsBounded(t *testing.T) {
	v, err := protovalidate.New()
	if err != nil {
		t.Fatalf("protovalidate.New: %v", err)
	}

	refs := func(n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("SHP-%d", i)
		}

		return out
	}

	req := func(shopID uint64, refs []string) *sellingv1.OrderDraftByExternalRefsRequest {
		return &sellingv1.OrderDraftByExternalRefsRequest{
			TeamId: 2,
			Filter: &sellingv1.OrderDraftByExternalRefsFilter{ShopId: shopID, Refs: refs},
		}
	}

	err = v.Validate(req(31, refs(50)))
	if err != nil {
		t.Fatalf("50 refs must pass: %v", err)
	}

	for name, bad := range map[string]*sellingv1.OrderDraftByExternalRefsRequest{
		"51 refs":    req(31, refs(51)),
		"no refs":    req(31, nil),
		"no shop":    req(0, refs(1)),
		"empty ref":  req(31, []string{""}),
		"repeat ref": req(31, []string{"A", "A"}),
		"no filter":  {TeamId: 2},
	} {
		err = v.Validate(bad)
		if err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
}
