package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// The round trip: archive drops it out of the ACTIVE list into the ARCHIVED one, restore puts it back.
func TestProductUnarchive_RoundTrip(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Widget")

	_, err := svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductArchive: %v", err)
	}

	archived := listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED)
	if len(archived) != 1 || archived[0] != id {
		t.Fatalf("archived list = %v, want [%d]", archived, id)
	}

	res, err := svc.ProductUnarchive(context.Background(), connect.NewRequest(&productv1.ProductUnarchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductUnarchive: %v", err)
	}
	if res.Msg.GetProduct().GetArchived() {
		t.Fatalf("restored product still reads as deleted")
	}

	active := listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ACTIVE)
	if len(active) != 1 || active[0] != id {
		t.Fatalf("active list = %v, want [%d]", active, id)
	}

	if len(listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED)) != 0 {
		t.Fatalf("restored product still in the archived list")
	}
}

// An archived product KEEPS its code (a-used-product-is-archived-never-deleted, the-field-is-product-code-composed-on-write):
// nothing can take it while the product is away, so the way back has nothing to resolve and lands under the same code.
func TestProductUnarchive_ComesBackUnderTheCodeItKept(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "SHOE-42", Name: "Original",
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	id := created.Msg.GetProduct().GetId()

	_, err = svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductArchive: %v", err)
	}

	// While it is away its code is still taken — TestProductCreate_AnArchivedProductsCodeIsStillTaken refuses the create.

	res, err := svc.ProductUnarchive(context.Background(), connect.NewRequest(&productv1.ProductUnarchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductUnarchive: %v", err)
	}

	if got := res.Msg.GetProduct(); got.GetProductCode() != "T2-SHOE-42" || got.GetArchived() {
		t.Fatalf("unarchived = %q archived=%v, want T2-SHOE-42, active", got.GetProductCode(), got.GetArchived())
	}
}

// An ACTIVE product is not restorable — "restore" is meaningless for something that never went away.
func TestProductUnarchive_ActiveReadsAsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Widget")

	_, err := svc.ProductUnarchive(context.Background(), connect.NewRequest(&productv1.ProductUnarchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("restore of an active product code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestProductUnarchive_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2 product")

	_, err := svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductArchive: %v", err)
	}

	_, err = svc.ProductUnarchive(context.Background(), connect.NewRequest(&productv1.ProductUnarchiveRequest{
		TeamId: 3, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team restore code = %v, want NotFound", connect.CodeOf(err))
	}
}

// listProducts returns the ids one status tab shows.
func listProducts(t *testing.T, svc *product_v1.Service, teamID uint64, status productv1.ProductStatus) []uint64 {
	t.Helper()

	res, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: teamID,
		Filter: &productv1.ProductListFilter{Status: status},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList(%v): %v", status, err)
	}

	return res.Msg.GetIds()
}
