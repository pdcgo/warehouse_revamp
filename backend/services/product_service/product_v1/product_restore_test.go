package product_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// The round trip: archive drops it out of the ACTIVE list into the ARCHIVED one, restore puts it back.
func TestProductRestore_RoundTrip(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Widget")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDelete: %v", err)
	}

	archived := listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED)
	if len(archived) != 1 || archived[0] != id {
		t.Fatalf("archived list = %v, want [%d]", archived, id)
	}

	res, err := svc.ProductRestore(context.Background(), connect.NewRequest(&productv1.ProductRestoreRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductRestore: %v", err)
	}
	if res.Msg.GetProduct().GetDeleted() {
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

// Archiving frees the SKU, so a re-used one must block the restore rather than land two live products
// on one SKU — and the refusal has to name who holds it.
func TestProductRestore_SkuTakenIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Original")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDelete: %v", err)
	}

	insertProduct(t, db, 2, "SKU-1", "The replacement")

	_, err = svc.ProductRestore(context.Background(), connect.NewRequest(&productv1.ProductRestoreRequest{
		TeamId: 2, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("restore onto a taken SKU code = %v, want AlreadyExists", connect.CodeOf(err))
	}
	if !strings.Contains(err.Error(), "The replacement") {
		t.Fatalf("refusal does not name the holder: %v", err)
	}

	// It stays archived — a refused restore must not half-apply.
	if len(listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED)) != 1 {
		t.Fatalf("refused restore left the product out of the archived list")
	}
}

// The way out of that collision, in one step: restore under a free SKU.
func TestProductRestore_WithNewSku(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Original")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDelete: %v", err)
	}

	insertProduct(t, db, 2, "SKU-1", "The replacement")

	sku := "SKU-1-OLD"

	res, err := svc.ProductRestore(context.Background(), connect.NewRequest(&productv1.ProductRestoreRequest{
		TeamId: 2, ProductId: id, Sku: &sku,
	}))
	if err != nil {
		t.Fatalf("ProductRestore with new sku: %v", err)
	}
	if res.Msg.GetProduct().GetSku() != sku {
		t.Fatalf("restored sku = %q, want %q", res.Msg.GetProduct().GetSku(), sku)
	}

	if len(listProducts(t, svc, 2, productv1.ProductStatus_PRODUCT_STATUS_ACTIVE)) != 2 {
		t.Fatalf("want both the replacement and the restored product active")
	}
}

// An ACTIVE product is not restorable — "restore" is meaningless for something that never went away.
func TestProductRestore_ActiveReadsAsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Widget")

	_, err := svc.ProductRestore(context.Background(), connect.NewRequest(&productv1.ProductRestoreRequest{
		TeamId: 2, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("restore of an active product code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestProductRestore_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2 product")

	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDelete: %v", err)
	}

	_, err = svc.ProductRestore(context.Background(), connect.NewRequest(&productv1.ProductRestoreRequest{
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
