package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func deleteProduct(svc *product_v1.Service, teamID, productID uint64) error {
	_, err := svc.ProductDelete(context.Background(), connect.NewRequest(&productv1.ProductDeleteRequest{
		TeamId: teamID, ProductId: productID,
	}))

	return err
}

func productRows(t *testing.T, db *gorm.DB, id uint64) int64 {
	t.Helper()

	var n int64

	err := db.Model(&product_service_models.Product{}).Where("id = ?", id).Count(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return n
}

// A NEVER-USED product — a typo — is DELETED for good, active or archived, and its code is free again
// (a-used-product-is-archived-never-deleted).
func TestProductDelete_RemovesANeverUsedProductAndFreesItsCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typo := insertProduct(t, db, 2, "T2-SKU-1", "Typo")
	archived := insertProduct(t, db, 2, "T2-SKU-2", "A duplicate, archived first")

	_, err := svc.ProductArchive(context.Background(), connect.NewRequest(&productv1.ProductArchiveRequest{TeamId: 2, ProductId: archived}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	for _, id := range []uint64{typo, archived} {
		err := deleteProduct(svc, 2, id)
		if err != nil {
			t.Fatalf("delete %d: %v", id, err)
		}

		if n := productRows(t, db, id); n != 0 {
			t.Fatalf("product %d still has %d rows after a delete", id, n)
		}
	}

	_, err = svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{TeamId: 2, ProductCodePart: "SKU-1", Name: "Re-entered"}))
	if err != nil {
		t.Fatalf("the code of a deleted product is not free: %v", err)
	}
}

// A product WITH HISTORY is refused — FailedPrecondition, pointing at Archive — and stays.
func TestProductDelete_RefusesAProductWithHistory(t *testing.T) {
	db := san_testdb.DB(t)
	used := insertProduct(t, db, 2, "SKU-1", "Sold once")
	svc := product_v1.NewService(db, fakeHistory{used: true}, teamCodes, nil, nil)

	err := deleteProduct(svc, 2, used)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("delete of a used product: %v, want FailedPrecondition", err)
	}

	if n := productRows(t, db, used); n != 1 {
		t.Fatalf("a refused delete removed the row")
	}
}

// ⚠ A product a BUNDLE still names is refused too: the line holds it by a foreign key, and taking it out of the bundle
// is the bundle owner's choice, never a side effect of a delete.
func TestProductDelete_RefusesAProductInABundle(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	gula := insertProduct(t, db, melati, "GULA-1", "Gula")
	createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), melati, "Paket", lines(gula, 2))

	err := deleteProduct(svc, melati, gula)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("delete of a bundled product: %v, want FailedPrecondition", err)
	}
}

// Another team's product is NotFound — the error confirms nothing.
func TestProductDelete_AnotherTeamsIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2's")

	err := deleteProduct(svc, 3, id)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete: %v, want NotFound", err)
	}
}
