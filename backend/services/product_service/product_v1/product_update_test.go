package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func TestProductUpdate_ChangesFields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Old name")

	resp, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, Name: proto.String("New name"),
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}
	if resp.Msg.GetProduct().GetName() != "New name" || resp.Msg.GetProduct().GetProductCode() != "SKU-1" {
		t.Fatalf("unexpected after update: %+v", resp.Msg.GetProduct())
	}
}

// A present images wrapper REPLACES the gallery and re-denormalises the cover; a nil wrapper leaves
// the images alone; an empty wrapper clears them.
func TestProductUpdate_ReplacesImages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "U-IMG", Name: "Start", CategoryId: 1,
		Images: []*productv1.ProductImage{
			{Url: "https://cdn/old1.jpg", ThumbnailUrl: "https://cdn/old1_t.jpg"},
			{Url: "https://cdn/old2.jpg"},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetProduct().GetId()

	// Replace two images with one; the cover follows to the new first image.
	resp, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id,
		Images: &productv1.ProductImages{Items: []*productv1.ProductImage{
			{Url: "https://cdn/new.jpg", ThumbnailUrl: "https://cdn/new_t.jpg"},
		}},
	}))
	if err != nil {
		t.Fatalf("update replace: %v", err)
	}
	if got := resp.Msg.GetProduct(); len(got.GetImages()) != 1 ||
		got.GetImages()[0].GetUrl() != "https://cdn/new.jpg" ||
		got.GetDefaultImageUrl() != "https://cdn/new.jpg" {
		t.Fatalf("after replace: %+v", resp.Msg.GetProduct())
	}

	// A nil wrapper (rename only) leaves the single image alone.
	resp, err = svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, Name: proto.String("Renamed"),
	}))
	if err != nil {
		t.Fatalf("update rename: %v", err)
	}
	if got := resp.Msg.GetProduct(); got.GetName() != "Renamed" || len(got.GetImages()) != 1 {
		t.Fatalf("rename should keep images: %+v", resp.Msg.GetProduct())
	}

	// An empty wrapper clears the gallery and the cover.
	resp, err = svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, Images: &productv1.ProductImages{},
	}))
	if err != nil {
		t.Fatalf("update clear: %v", err)
	}
	if got := resp.Msg.GetProduct(); len(got.GetImages()) != 0 || got.GetDefaultImageUrl() != "" {
		t.Fatalf("after clear: %+v", resp.Msg.GetProduct())
	}
}

func TestProductUpdate_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: 9999, Name: proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// A product belongs to team 2; team 3 must not be able to update it via its own scope.
func TestProductUpdate_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2 product")

	_, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 3, ProductId: id, Name: proto.String("hijacked"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update code = %v, want NotFound", connect.CodeOf(err))
	}
}

// A never-used product's code may be CORRECTED: the team sends a new part, and the product is re-composed under its
// team's prefix (the-field-is-product-code-composed-on-write).
func TestProductUpdate_CorrectsTheCodePartOfANeverUsedProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := createProduct(t, svc, 2, "SHOE-42")

	resp, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, ProductCodePart: proto.String("SHOE-43"),
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}

	if code := resp.Msg.GetProduct().GetProductCode(); code != "T2-SHOE-43" {
		t.Fatalf("code = %q, want T2-SHOE-43", code)
	}
}

// Once the product has a HISTORY a sticker can exist, so its code is fixed — FailedPrecondition, and nothing else in the
// same update lands either.
func TestProductUpdate_RefusesACodeCorrectionOnceUsed(t *testing.T) {
	db := san_testdb.DB(t)
	id := createProduct(t, newService(t, db), 2, "SHOE-42")
	svc := product_v1.NewService(db, fakeHistory{id: true}, teamCodes, nil, nil)

	_, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, ProductCodePart: proto.String("SHOE-43"), Name: proto.String("Renamed"),
	}))
	if codeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("correction of a used product = %v, want FailedPrecondition", codeOf(err))
	}

	detail := productDetail(t, svc, 2, id)
	if detail.GetProductCode() != "T2-SHOE-42" || detail.GetName() != "Widget" {
		t.Fatalf("after a refused correction: code %q name %q, want T2-SHOE-42 / Widget", detail.GetProductCode(), detail.GetName())
	}
}

// Sending the part the product ALREADY has is not a correction, so a form that always sends it still saves a used
// product's other fields.
func TestProductUpdate_TheSamePartIsNoCorrection(t *testing.T) {
	db := san_testdb.DB(t)
	id := createProduct(t, newService(t, db), 2, "SHOE-42")
	svc := product_v1.NewService(db, fakeHistory{id: true}, teamCodes, nil, nil)

	resp, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, ProductCodePart: proto.String("SHOE-42"), Name: proto.String("Renamed"),
	}))
	if err != nil {
		t.Fatalf("ProductUpdate: %v", err)
	}

	if got := resp.Msg.GetProduct(); got.GetProductCode() != "T2-SHOE-42" || got.GetName() != "Renamed" {
		t.Fatalf("after update: code %q name %q", got.GetProductCode(), got.GetName())
	}
}

// A correction onto a code another product holds — archived or not — is AlreadyExists.
func TestProductUpdate_ACorrectionOntoATakenCodeIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	taken := createProduct(t, svc, 2, "SHOE-43")
	setProduct(t, db, taken, "archived", true)

	id := createProduct(t, svc, 2, "SHOE-42")

	_, err := svc.ProductUpdate(context.Background(), connect.NewRequest(&productv1.ProductUpdateRequest{
		TeamId: 2, ProductId: id, ProductCodePart: proto.String("SHOE-43"),
	}))
	if codeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("correction onto a taken code = %v, want AlreadyExists", codeOf(err))
	}
}

// createProduct makes a product named Widget through the handler, under the team's part, and returns its id.
func createProduct(t *testing.T, svc *product_v1.Service, teamID uint64, part string) uint64 {
	t.Helper()

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: teamID, ProductCodePart: part, Name: "Widget",
	}))
	if err != nil {
		t.Fatalf("ProductCreate %q: %v", part, err)
	}

	return resp.Msg.GetProduct().GetId()
}

func productDetail(t *testing.T, svc *product_v1.Service, teamID, productID uint64) *productv1.Product {
	t.Helper()

	resp, err := svc.ProductDetail(context.Background(), connect.NewRequest(&productv1.ProductDetailRequest{
		TeamId: teamID, ProductId: productID,
	}))
	if err != nil {
		t.Fatalf("ProductDetail: %v", err)
	}

	return resp.Msg.GetProduct()
}
