package category_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestCategoryUpdate_RenameAndReparent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	oldParent := insertCategory(t, db, "Old parent", nil)
	newParent := insertCategory(t, db, "New parent", nil)
	id := insertCategory(t, db, "Original", &oldParent)

	// Rename only — parent is left alone.
	resp, err := svc.CategoryUpdate(context.Background(), connect.NewRequest(&categoryv1.CategoryUpdateRequest{
		CategoryId: id, Name: proto.String("Renamed"),
	}))
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if resp.Msg.GetCategory().GetName() != "Renamed" || resp.Msg.GetCategory().GetParentId() != oldParent {
		t.Fatalf("after rename: %+v", resp.Msg.GetCategory())
	}

	// Reparent to another category.
	resp, err = svc.CategoryUpdate(context.Background(), connect.NewRequest(&categoryv1.CategoryUpdateRequest{
		CategoryId: id, ParentId: proto.Uint64(newParent),
	}))
	if err != nil {
		t.Fatalf("reparent: %v", err)
	}
	if resp.Msg.GetCategory().GetParentId() != newParent {
		t.Fatalf("after reparent parent_id = %d, want %d", resp.Msg.GetCategory().GetParentId(), newParent)
	}

	// Reparent to top-level: 0 → NULL.
	resp, err = svc.CategoryUpdate(context.Background(), connect.NewRequest(&categoryv1.CategoryUpdateRequest{
		CategoryId: id, ParentId: proto.Uint64(0),
	}))
	if err != nil {
		t.Fatalf("reparent to top-level: %v", err)
	}
	if resp.Msg.GetCategory().GetParentId() != 0 {
		t.Fatalf("after top-level reparent parent_id = %d, want 0", resp.Msg.GetCategory().GetParentId())
	}
}

func TestCategoryUpdate_SelfParentRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertCategory(t, db, "Self", nil)

	_, err := svc.CategoryUpdate(context.Background(), connect.NewRequest(&categoryv1.CategoryUpdateRequest{
		CategoryId: id, ParentId: proto.Uint64(id),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("self-parent code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestCategoryUpdate_BadParentRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertCategory(t, db, "Movable", nil)

	_, err := svc.CategoryUpdate(context.Background(), connect.NewRequest(&categoryv1.CategoryUpdateRequest{
		CategoryId: id, ParentId: proto.Uint64(9999),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("bad parent code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestCategoryUpdate_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.CategoryUpdate(context.Background(), connect.NewRequest(&categoryv1.CategoryUpdateRequest{
		CategoryId: 9999, Name: proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
