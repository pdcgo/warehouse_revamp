package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

func TestProductDetail_ReturnsOrderedGallery(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "D-1", Name: "Detailed", CategoryId: 4,
		Images: []*productv1.ProductImage{
			{Url: "https://cdn/1.jpg", ThumbnailUrl: "https://cdn/1_t.jpg"},
			{Url: "https://cdn/2.jpg", ThumbnailUrl: "https://cdn/2_t.jpg"},
			{Url: "https://cdn/3.jpg", ThumbnailUrl: "https://cdn/3_t.jpg"},
		},
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	id := created.Msg.GetProduct().GetId()

	resp, err := svc.ProductDetail(context.Background(), connect.NewRequest(&productv1.ProductDetailRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDetail: %v", err)
	}

	got := resp.Msg.GetProduct()
	if got.GetCategoryId() != 4 {
		t.Fatalf("category = %d, want 4", got.GetCategoryId())
	}
	if len(got.GetImages()) != 3 {
		t.Fatalf("images len = %d, want 3", len(got.GetImages()))
	}
	// Order must be preserved (position ASC).
	for i, want := range []string{"https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg"} {
		if got.GetImages()[i].GetUrl() != want {
			t.Fatalf("image[%d] = %q, want %q", i, got.GetImages()[i].GetUrl(), want)
		}
	}
}

// ProductDetail must order by `position`, NOT by insertion/id order. Seed images whose position
// is deliberately shuffled relative to their id so an accidental "ORDER BY id" would return the
// wrong sequence and fail this test.
func TestProductDetail_OrdersByPositionNotId(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "ORD-1", "Ordered")

	// Insert in id order A, B, C but with positions 2, 0, 1 — so position order is B, C, A.
	rows := []product_service_models.ProductImage{
		{ProductID: id, URL: "https://cdn/A.jpg", Position: 2},
		{ProductID: id, URL: "https://cdn/B.jpg", Position: 0},
		{ProductID: id, URL: "https://cdn/C.jpg", Position: 1},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("seed image: %v", err)
		}
	}

	resp, err := svc.ProductDetail(context.Background(), connect.NewRequest(&productv1.ProductDetailRequest{
		TeamId: 2, ProductId: id,
	}))
	if err != nil {
		t.Fatalf("ProductDetail: %v", err)
	}

	got := resp.Msg.GetProduct().GetImages()
	want := []string{"https://cdn/B.jpg", "https://cdn/C.jpg", "https://cdn/A.jpg"}
	if len(got) != len(want) {
		t.Fatalf("images len = %d, want %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].GetUrl() != w {
			t.Fatalf("image[%d] = %q, want %q (must be position-ordered, not id-ordered)", i, got[i].GetUrl(), w)
		}
	}
}

// A product belongs to team 2; team 3 must not read it via its own scope.
func TestProductDetail_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "SKU-1", "Team 2 product")

	_, err := svc.ProductDetail(context.Background(), connect.NewRequest(&productv1.ProductDetailRequest{
		TeamId: 3, ProductId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team detail code = %v, want NotFound", connect.CodeOf(err))
	}
}
