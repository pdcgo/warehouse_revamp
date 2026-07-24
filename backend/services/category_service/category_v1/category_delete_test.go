package category_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Soft delete: the category drops out of the list, and its name becomes reusable.
func TestCategoryDelete_SoftDeletesAndFreesName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertCategory(t, db, "Temporary", nil)

	_, err := svc.CategoryDelete(context.Background(), connect.NewRequest(&categoryv1.CategoryDeleteRequest{
		CategoryId: id,
	}))
	if err != nil {
		t.Fatalf("CategoryDelete: %v", err)
	}

	list, err := svc.CategoryList(context.Background(), connect.NewRequest(&categoryv1.CategoryListRequest{}))
	if err != nil {
		t.Fatalf("CategoryList: %v", err)
	}
	if len(list.Msg.GetCategories()) != 0 {
		t.Fatalf("deleted category still listed (%d)", len(list.Msg.GetCategories()))
	}

	// Name is free again after the soft delete.
	_, err = svc.CategoryCreate(context.Background(), connect.NewRequest(&categoryv1.CategoryCreateRequest{
		Name: "Temporary",
	}))
	if err != nil {
		t.Fatalf("recreate with freed name: %v", err)
	}
}

// A category with active children cannot be deleted — that would orphan them.
func TestCategoryDelete_WithChildrenRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	parent := insertCategory(t, db, "Parent", nil)
	insertCategory(t, db, "Child", &parent)

	_, err := svc.CategoryDelete(context.Background(), connect.NewRequest(&categoryv1.CategoryDeleteRequest{
		CategoryId: parent,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("delete-with-children code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

func TestCategoryDelete_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.CategoryDelete(context.Background(), connect.NewRequest(&categoryv1.CategoryDeleteRequest{
		CategoryId: 9999,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
