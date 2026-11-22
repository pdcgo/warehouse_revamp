package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// The categories these tests file products under — far above any id another test or the dev seed hands out, because the
// count is every team's and the test database may already hold other tests' committed products.
const (
	ccMakanan uint64 = 9_115_001
	ccSnack   uint64 = 9_115_002
	ccKeripik uint64 = 9_115_003
	ccArsip   uint64 = 9_115_004
)

// fileProduct seeds a product of `teamID` filed under `categoryID`, archived or not.
func fileProduct(t *testing.T, db *gorm.DB, teamID, categoryID uint64, code string, archived bool) {
	t.Helper()

	p := product_service_models.Product{
		TeamID:      teamID,
		ProductCode: code,
		Name:        code,
		CategoryID:  categoryID,
		Archived:    archived,
	}

	err := db.Create(&p).Error
	if err != nil {
		t.Fatalf("file product %s: %v", code, err)
	}
}

// categoryCounts calls the RPC and keys the answer by category id; it also fails on a category answered twice or out
// of id order.
func categoryCounts(t *testing.T, db *gorm.DB) (map[uint64]uint64, []uint64) {
	t.Helper()

	resp, err := newService(t, db).ProductCategoryCounts(
		context.Background(),
		connect.NewRequest(&productv1.ProductCategoryCountsRequest{}),
	)
	if err != nil {
		t.Fatalf("ProductCategoryCounts: %v", err)
	}

	byID := map[uint64]uint64{}
	order := make([]uint64, 0, len(resp.Msg.GetCounts()))

	for _, c := range resp.Msg.GetCounts() {
		_, twice := byID[c.GetCategoryId()]
		if twice {
			t.Fatalf("category %d answered twice", c.GetCategoryId())
		}

		byID[c.GetCategoryId()] = c.GetProducts()
		order = append(order, c.GetCategoryId())
	}

	if !slices.IsSorted(order) {
		t.Fatalf("the counts are not in category id order: %v", order)
	}

	return byID, order
}

// THE KATEGORI PAGE'S PRODUK COUNT (the-product-count-is-a-marked-sample): how many products are filed DIRECTLY on each
// category — every team's catalogue, never one team's — with the archived ones left out (an archived product is out of
// the list and every picker). A node's count is its own: Makanan's 2 do not include Snack's or Keripik's (the page sums
// a branch from the tree it holds). A category holding only archived products is not listed, and nor is category 0 (a
// product from before categories existed — no node can show it).
func TestProductCategoryCounts_CountsEveryTeamsLiveProductsPerCategory(t *testing.T) {
	db := san_testdb.DB(t)

	// Makanan: two teams' products, one more archived.
	fileProduct(t, db, 2, ccMakanan, "T2-CC-MKN-1", false)
	fileProduct(t, db, 3, ccMakanan, "T3-CC-MKN-1", false)
	fileProduct(t, db, 3, ccMakanan, "T3-CC-MKN-ARS", true)

	// Snack, under Makanan in the tree — counted on its own node only.
	fileProduct(t, db, 2, ccSnack, "T2-CC-SNK-1", false)
	fileProduct(t, db, 4, ccSnack, "T4-CC-SNK-1", false)
	fileProduct(t, db, 4, ccSnack, "T4-CC-SNK-2", false)

	// Keripik: one team's.
	fileProduct(t, db, 5, ccKeripik, "T5-CC-KRP-1", false)

	// Arsip: archived products only.
	fileProduct(t, db, 2, ccArsip, "T2-CC-ARS-1", true)
	fileProduct(t, db, 3, ccArsip, "T3-CC-ARS-1", true)

	// A product on no category.
	fileProduct(t, db, 2, 0, "T2-CC-NONE", false)

	counts, order := categoryCounts(t, db)

	want := map[uint64]uint64{ccMakanan: 2, ccSnack: 3, ccKeripik: 1}
	for id, n := range want {
		if counts[id] != n {
			t.Errorf("category %d counts %d products, want %d", id, counts[id], n)
		}
	}

	_, listed := counts[ccArsip]
	if listed {
		t.Errorf("a category holding only archived products is listed with %d — want it left out", counts[ccArsip])
	}

	_, listed = counts[0]
	if listed {
		t.Errorf("category 0 (no category) is listed with %d — want it left out", counts[0])
	}

	for _, id := range order {
		if counts[id] == 0 {
			t.Errorf("category %d is listed with 0 products — a category holding none is not listed", id)
		}
	}
}

// Archiving a product takes it out of its category's count, and unarchiving brings it back — the count reads the
// products as they are now, through the real archive and unarchive.
func TestProductCategoryCounts_FollowsArchiveAndUnarchive(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fileProduct(t, db, 2, ccSnack, "T2-CC-ARC-1", false)
	fileProduct(t, db, 2, ccSnack, "T2-CC-ARC-2", false)

	var id uint64

	err := db.
		Model(&product_service_models.Product{}).
		Where("product_code = ?", "T2-CC-ARC-2").
		Pluck("id", &id).
		Error
	if err != nil {
		t.Fatalf("find the product: %v", err)
	}

	_, err = svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductArchive: %v", err)
	}

	counts, _ := categoryCounts(t, db)
	if counts[ccSnack] != 1 {
		t.Fatalf("after the archive, Snack counts %d — want 1", counts[ccSnack])
	}

	_, err = svc.ProductUnarchive(context.Background(), connect.NewRequest(&productv1.ProductUnarchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductUnarchive: %v", err)
	}

	counts, _ = categoryCounts(t, db)
	if counts[ccSnack] != 2 {
		t.Fatalf("after the unarchive, Snack counts %d — want 2", counts[ccSnack])
	}
}

// WHO MAY ASK (the ACL is the proto's): Root and the Administrator alone, as the Kategori page is theirs — and with NO
// team scope, so no team role could ever be read into it (an unscoped roles-policy is judged in the root team). A READ:
// marked NO_SIDE_EFFECTS. The interceptor's own run of every role is
// access_interceptors.TestProductCategoryCounts_RootAndTheAdministratorAlone.
func TestProductCategoryCounts_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.product.v1.ProductCategoryCountsRequest")
	if err != nil {
		t.Fatal(err)
	}

	md := desc.(protoreflect.MessageDescriptor)

	policy := san_auth.PolicyOf(md)
	if policy == nil {
		t.Fatal("ProductCategoryCountsRequest has no policy — it would be denied to everyone")
	}

	want := []role_basev1.Role{role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Errorf("roles = %v, want %v", policy.GetRoles(), want)
	}

	if policy.GetAllowAll() || policy.GetAllowOnlyAuthenticated() {
		t.Error("the policy opens the count to more than Root and the Administrator")
	}

	_, scoped := san_auth.ScopeOf(&productv1.ProductCategoryCountsRequest{})
	if scoped || md.Fields().Len() != 0 {
		t.Errorf("the request carries fields (%d) or a team scope (%v) — it must be unscoped", md.Fields().Len(), scoped)
	}

	rpc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.product.v1.ProductService.ProductCategoryCounts")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := rpc.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Error("ProductCategoryCounts is not marked a read (NO_SIDE_EFFECTS)")
	}
}
