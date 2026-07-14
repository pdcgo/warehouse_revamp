package category_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestCategoryCreate_TopLevelAndChild(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	parent, err := svc.CategoryCreate(context.Background(), connect.NewRequest(&categoryv1.CategoryCreateRequest{
		Name: "Electronics",
	}))
	if err != nil {
		t.Fatalf("create top-level: %v", err)
	}
	if parent.Msg.GetCategory().GetId() == 0 || parent.Msg.GetCategory().GetParentId() != 0 {
		t.Fatalf("unexpected top-level category: %+v", parent.Msg.GetCategory())
	}

	child, err := svc.CategoryCreate(context.Background(), connect.NewRequest(&categoryv1.CategoryCreateRequest{
		Name: "Phones", ParentId: parent.Msg.GetCategory().GetId(),
	}))
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	if child.Msg.GetCategory().GetParentId() != parent.Msg.GetCategory().GetId() {
		t.Fatalf("child parent_id = %d, want %d",
			child.Msg.GetCategory().GetParentId(), parent.Msg.GetCategory().GetId())
	}
}

// A parent_id that names no active category is rejected as an argument error.
func TestCategoryCreate_BadParentRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.CategoryCreate(context.Background(), connect.NewRequest(&categoryv1.CategoryCreateRequest{
		Name: "Orphan", ParentId: 9999,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("bad parent code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// Name is unique among active categories under the same parent (top-level rows share the NULL
// bucket, so two top-level "Tools" collide).
func TestCategoryCreate_DuplicateNameUnderSameParentRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[categoryv1.CategoryCreateRequest] {
		return connect.NewRequest(&categoryv1.CategoryCreateRequest{Name: "Tools"})
	}

	_, err := svc.CategoryCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.CategoryCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate name code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// The same name is fine under a DIFFERENT parent.
func TestCategoryCreate_SameNameDifferentParentOk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := insertCategory(t, db, "Brand A", nil)
	b := insertCategory(t, db, "Brand B", nil)

	_, err := svc.CategoryCreate(context.Background(), connect.NewRequest(&categoryv1.CategoryCreateRequest{
		Name: "Cables", ParentId: a,
	}))
	if err != nil {
		t.Fatalf("create under A: %v", err)
	}

	_, err = svc.CategoryCreate(context.Background(), connect.NewRequest(&categoryv1.CategoryCreateRequest{
		Name: "Cables", ParentId: b,
	}))
	if err != nil {
		t.Fatalf("same name under a different parent should succeed: %v", err)
	}
}
