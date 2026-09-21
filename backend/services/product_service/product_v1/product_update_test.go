package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
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
	if resp.Msg.GetProduct().GetName() != "New name" || resp.Msg.GetProduct().GetSku() != "SKU-1" {
		t.Fatalf("unexpected after update: %+v", resp.Msg.GetProduct())
	}
}

// A present images wrapper REPLACES the gallery and re-denormalises the cover; a nil wrapper leaves
// the images alone; an empty wrapper clears them.
func TestProductUpdate_ReplacesImages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	created, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, Sku: "U-IMG", Name: "Start", CategoryId: 1,
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
