package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestProductCreate_CreatesInTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SKU-1", Name: "Widget", Description: "a widget",
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	got := resp.Msg.GetProduct()
	if got.GetId() == 0 || got.GetTeamId() != 2 || got.GetSku() != "SKU-1" || got.GetName() != "Widget" {
		t.Fatalf("unexpected product: %+v", got)
	}
}

// A create carries a category and up to 5 images; the first image is denormalised as the cover.
func TestProductCreate_WithCategoryAndImages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "IMG-1", Name: "Photographed", CategoryId: 7,
		Images: []*productv1.ProductImage{
			{Url: "https://cdn/a.jpg", ThumbnailUrl: "https://cdn/a_t.jpg"},
			{Url: "https://cdn/b.jpg", ThumbnailUrl: "https://cdn/b_t.jpg"},
		},
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	got := resp.Msg.GetProduct()
	if got.GetCategoryId() != 7 {
		t.Fatalf("category = %d, want 7", got.GetCategoryId())
	}
	// The cover mirrors the FIRST image.
	if got.GetDefaultImageUrl() != "https://cdn/a.jpg" || got.GetDefaultImageThumbnailUrl() != "https://cdn/a_t.jpg" {
		t.Fatalf("cover = %q / %q", got.GetDefaultImageUrl(), got.GetDefaultImageThumbnailUrl())
	}
	if len(got.GetImages()) != 2 || got.GetImages()[0].GetUrl() != "https://cdn/a.jpg" || got.GetImages()[1].GetUrl() != "https://cdn/b.jpg" {
		t.Fatalf("images = %+v", got.GetImages())
	}
}

// SKU is unique per team among active products.
func TestProductCreate_DuplicateSkuRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[productv1.ProductCreateRequest] {
		return connect.NewRequest(&productv1.ProductCreateRequest{TeamId: 2, Sku: "DUP", Name: "First"})
	}

	_, err := svc.ProductCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.ProductCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate SKU code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// The same SKU is fine in a DIFFERENT team.
func TestProductCreate_SameSkuDifferentTeamOk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "SHARED", Name: "A",
	}))
	if err != nil {
		t.Fatalf("team 2 create: %v", err)
	}

	_, err = svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 3, Sku: "SHARED", Name: "B",
	}))
	if err != nil {
		t.Fatalf("team 3 create with same SKU should succeed: %v", err)
	}
}
