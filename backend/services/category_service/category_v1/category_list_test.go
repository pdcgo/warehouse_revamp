package category_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

// List returns the active taxonomy flat, ordered by name, each node carrying its parent_id; a
// soft-deleted category never appears.
func TestCategoryList_ReturnsActiveTreeFlat(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	electronics := insertCategory(t, db, "Electronics", nil)
	insertCategory(t, db, "Phones", &electronics)
	insertCategory(t, db, "Apparel", nil)

	deletedID := insertCategory(t, db, "Deprecated", nil)
	err := db.
		Model(&category_service_models.Category{}).
		Where("id = ?", deletedID).
		Update("deleted", true).
		Error
	if err != nil {
		t.Fatalf("soft-delete seed: %v", err)
	}

	resp, err := svc.CategoryList(context.Background(), connect.NewRequest(&categoryv1.CategoryListRequest{}))
	if err != nil {
		t.Fatalf("CategoryList: %v", err)
	}

	cats := resp.Msg.GetCategories()
	if len(cats) != 3 {
		t.Fatalf("got %d categories, want 3 (the deleted one must not appear)", len(cats))
	}

	// Ordered by name.
	wantOrder := []string{"Apparel", "Electronics", "Phones"}
	for i, w := range wantOrder {
		if cats[i].GetName() != w {
			t.Fatalf("order[%d] = %q, want %q", i, cats[i].GetName(), w)
		}
	}

	// The child carries its parent_id so the client can rebuild the tree.
	for _, c := range cats {
		if c.GetName() == "Phones" && c.GetParentId() != electronics {
			t.Fatalf("Phones parent_id = %d, want %d", c.GetParentId(), electronics)
		}
	}
}
