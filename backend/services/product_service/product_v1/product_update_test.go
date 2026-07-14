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
