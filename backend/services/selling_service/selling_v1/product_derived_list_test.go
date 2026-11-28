package selling_v1_test

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

	// Linked for its descriptors: the policy test compares this read's roles with ProductDiscover's.
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// PRODUK TURUNAN — a product's return maps both ways, across teams (produk-turunan-is-the-return-map). The return map's
// cast (product_return_map_create_test.go): team 2 sells team 9's 501 and 502 and owns 601 and 602; team 3 owns 701.
// Written through the REAL write, so every map here is one the order form could make:
//
//	team 2   501 → 601, then 502 → 601   two borrowed products landing on ONE own product (unique on the source only)
//	team 3   501 → 701                    another team's map of the same borrowed product
//
// Team 5 holds no map at all — it reads Discover, and the scoped team only authorizes.
const derivedReader uint64 = 5

func derivedMapsCast(t *testing.T, svc *selling_v1.Service) {
	t.Helper()

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)
	mapForReturns(t, svc, mapTeam, borrowedB, ourProduct)
	mapForReturns(t, svc, 3, borrowedA, 701)
}

func derivedOf(t *testing.T, svc *selling_v1.Service, teamID, productID uint64) *sellingv1.ProductDerivedListResponse {
	t.Helper()

	res, err := svc.ProductDerivedList(context.Background(), connect.NewRequest(&sellingv1.ProductDerivedListRequest{
		TeamId: teamID,
		Filter: &sellingv1.ProductDerivedListFilter{ProductId: productID},
	}))
	if err != nil {
		t.Fatalf("ProductDerivedList(%d): %v", productID, err)
	}

	return res.Msg
}

// pairsOf is a direction as "team:shared→own" lines, in the order answered.
func pairsOf(maps []*sellingv1.ProductReturnMap) [][3]uint64 {
	out := make([][3]uint64, 0, len(maps))
	for _, m := range maps {
		out = append(out, [3]uint64{m.GetTeamId(), m.GetSharedProductId(), m.GetOwnProductId()})
	}

	return out
}

// TURUNANNYA is every team's map FROM the product — team 2's and team 3's of 501, newest first — read by a team that
// holds neither. 501 lands nowhere itself, so its Turunan dari is empty.
func TestProductDerivedList_TurunannyaIsEveryTeamsMapFromTheProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	derivedMapsCast(t, svc)

	got := derivedOf(t, svc, derivedReader, borrowedA)

	want := [][3]uint64{{3, borrowedA, 701}, {mapTeam, borrowedA, ourProduct}}
	if !slices.Equal(pairsOf(got.GetDerivedTo()), want) {
		t.Fatalf("Turunannya = %v, want %v (every team's, newest first)", pairsOf(got.GetDerivedTo()), want)
	}

	if got.GetDerivedToTotal() != 2 {
		t.Fatalf("Turunannya total = %d, want 2", got.GetDerivedToTotal())
	}

	if len(got.GetDerivedFrom()) != 0 || got.GetDerivedFromTotal() != 0 {
		t.Fatalf("Turunan dari of a borrowed product = %v (total %d), want none", pairsOf(got.GetDerivedFrom()), got.GetDerivedFromTotal())
	}

	for _, m := range got.GetDerivedTo() {
		if m.GetCreatedAtUnix() == 0 {
			t.Fatalf("map %v carries no created_at", m)
		}
	}
}

// TURUNAN DARI is the maps landing ON the product — its owner team's — and SEVERAL may: 501 and 502 both land on 601
// (the map is unique on its source, not on its own product), each its own row, newest first.
func TestProductDerivedList_TurunanDariIsEveryMapOntoTheProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	derivedMapsCast(t, svc)

	got := derivedOf(t, svc, derivedReader, ourProduct)

	want := [][3]uint64{{mapTeam, borrowedB, ourProduct}, {mapTeam, borrowedA, ourProduct}}
	if !slices.Equal(pairsOf(got.GetDerivedFrom()), want) {
		t.Fatalf("Turunan dari = %v, want %v (both sources, newest first)", pairsOf(got.GetDerivedFrom()), want)
	}

	if got.GetDerivedFromTotal() != 2 {
		t.Fatalf("Turunan dari total = %d, want 2", got.GetDerivedFromTotal())
	}

	if len(got.GetDerivedTo()) != 0 || got.GetDerivedToTotal() != 0 {
		t.Fatalf("Turunannya of an own product nobody borrowed = %v, want none", pairsOf(got.GetDerivedTo()))
	}

	// Team 3's own product, from the other side: one map lands on it.
	other := derivedOf(t, svc, mapTeam, 701)
	if !slices.Equal(pairsOf(other.GetDerivedFrom()), [][3]uint64{{3, borrowedA, 701}}) {
		t.Fatalf("Turunan dari of 701 = %v, want team 3's 501 → 701", pairsOf(other.GetDerivedFrom()))
	}
}

// ANOTHER TEAM'S MAP IS SEEN HERE — and only here: the order form's ProductReturnMapByIds stays team-scoped, so the
// reader that sees both teams' maps of 501 is still told it has mapped nothing itself.
func TestProductDerivedList_SeesAcrossTeamsWhileTheOrderFormsReadStaysScoped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	derivedMapsCast(t, svc)

	for _, reader := range []uint64{derivedReader, mapTeam, 3} {
		if got := derivedOf(t, svc, reader, borrowedA); got.GetDerivedToTotal() != 2 {
			t.Fatalf("team %d read %d of 501's maps, want both teams' 2 — the scope must not narrow them", reader, got.GetDerivedToTotal())
		}
	}

	if got := returnMapsOf(t, svc, derivedReader, borrowedA); len(got) != 0 {
		t.Fatalf("ProductReturnMapByIds for team %d = %v — the order form's read must stay team-scoped", derivedReader, got)
	}

	if got := returnMapsOf(t, svc, 3, borrowedA); len(got) != 1 || got[borrowedA] != 701 {
		t.Fatalf("ProductReturnMapByIds for team 3 = %v, want only its own 501 → 701", got)
	}
}

// insertDerivedMaps writes n maps of one borrowed product straight into the table — n teams, each its own product,
// created a second apart (the newest last) — for the cap, past what the cast's catalogue holds.
func insertDerivedMaps(t *testing.T, db *gorm.DB, sharedID uint64, n int) {
	t.Helper()

	base := time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC)
	rows := make([]selling_service_models.ProductReturnMap, 0, n)

	for i := 1; i <= n; i++ {
		at := base.Add(time.Duration(i) * time.Second)
		rows = append(rows, selling_service_models.ProductReturnMap{
			TeamID:          uint64(1000 + i),
			SharedProductID: sharedID,
			OwnProductID:    uint64(50000 + i),
			CreatedAt:       at,
			UpdatedAt:       at,
		})
	}

	err := db.CreateInBatches(rows, 100).Error
	if err != nil {
		t.Fatalf("insert %d maps: %v", n, err)
	}
}

// CAPPED, NOT PAGED: a direction answers its newest 200 maps, and its total says how many there are — so a capped list
// never reads as the whole.
func TestProductDerivedList_EachDirectionIsCappedAtTwoHundredWithItsTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	insertDerivedMaps(t, db, borrowedA, 205)

	got := derivedOf(t, svc, derivedReader, borrowedA)

	if len(got.GetDerivedTo()) != 200 {
		t.Fatalf("Turunannya answered %d maps, want the cap of 200", len(got.GetDerivedTo()))
	}

	if got.GetDerivedToTotal() != 205 {
		t.Fatalf("Turunannya total = %d, want every map's 205", got.GetDerivedToTotal())
	}

	if first, last := got.GetDerivedTo()[0], got.GetDerivedTo()[199]; first.GetTeamId() != 1205 || last.GetTeamId() != 1006 {
		t.Fatalf("answered teams %d … %d, want the newest 200: 1205 … 1006", first.GetTeamId(), last.GetTeamId())
	}

	// The maps the cap left out are the OLDEST.
	for _, m := range got.GetDerivedTo() {
		if m.GetTeamId() <= 1005 {
			t.Fatalf("team %d's map is among the 200 — one of the five oldest", m.GetTeamId())
		}
	}
}

// A product no map names — here one nobody owns — reads two empty lists, never an error.
func TestProductDerivedList_AnUnknownProductReadsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)
	derivedMapsCast(t, svc)

	got := derivedOf(t, svc, derivedReader, 900)

	if len(got.GetDerivedFrom()) != 0 || len(got.GetDerivedTo()) != 0 || got.GetDerivedFromTotal() != 0 || got.GetDerivedToTotal() != 0 {
		t.Fatalf("product 900 read %+v, want nothing", got)
	}
}

// Who may read — Discover's people (ProductDiscover's policy, which is also the order form's ProductReturnMapByIds'):
// the selling side and root. A WAREHOUSE ROLE IS REFUSED, as Discover refuses it. A read, so the monitor and an agent's
// credential may call it (an-agent-only-reads-for-now); one product, always.
func TestProductDerivedList_DiscoversPeopleReadAndAWarehouseIsRefused(t *testing.T) {
	policyOf := func(name protoreflect.FullName) []role_basev1.Role {
		t.Helper()

		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(name)
		if err != nil {
			t.Fatalf("descriptor %s: %v", name, err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		return policy.GetRoles()
	}

	roles := policyOf("warehouse.selling.v1.ProductDerivedListRequest")

	for _, other := range []protoreflect.FullName{
		"warehouse.product.v1.ProductDiscoverRequest",
		"warehouse.selling.v1.ProductReturnMapByIdsRequest",
	} {
		if want := policyOf(other); !slices.Equal(roles, want) {
			t.Fatalf("roles = %v, want %s's %v", roles, other, want)
		}
	}

	for _, refused := range []role_basev1.Role{
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		if slices.Contains(roles, refused) {
			t.Fatalf("%s may read a product's derived products — Discover refuses a warehouse", refused)
		}
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName(
		"warehouse.selling.v1.TeamReturnConfigurationService.ProductDerivedList")
	if err != nil {
		t.Fatalf("method: %v", err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("ProductDerivedList must be marked NO_SIDE_EFFECTS")
	}

	v, err := protovalidate.New()
	if err != nil {
		t.Fatal(err)
	}

	for name, req := range map[string]*sellingv1.ProductDerivedListRequest{
		"no product": {TeamId: derivedReader, Filter: &sellingv1.ProductDerivedListFilter{}},
		"no filter":  {TeamId: derivedReader},
		"no team":    {Filter: &sellingv1.ProductDerivedListFilter{ProductId: borrowedA}},
	} {
		if v.Validate(req) == nil {
			t.Fatalf("%s: the request validated", name)
		}
	}
}
