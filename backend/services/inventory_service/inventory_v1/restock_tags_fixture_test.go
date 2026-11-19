package inventory_v1_test

import (
	"testing"
	"time"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RESTOCK TAGS (backlog #87) — the fixtures the tag tests share. The app's two problem tags are the migration's
// (00055), so every test database has them; a test's own tags are written straight into `tags` / `restock_tags`.

const (
	taskMissing = "restock.problem.missing"
	taskBroken  = "restock.problem.broken"
)

var (
	tagSystem = inventoryv1.RestockTagType_RESTOCK_TAG_TYPE_SYSTEM
	tagCustom = inventoryv1.RestockTagType_RESTOCK_TAG_TYPE_CUSTOM
)

// seedTag writes a tag of `kind` ("system" / "custom") with no app task, and returns its id.
func seedTag(t *testing.T, db *gorm.DB, name, kind string) uint64 {
	t.Helper()

	tag := inventory_service_models.Tag{Name: name, Type: kind}

	err := db.Create(&tag).Error
	if err != nil {
		t.Fatalf("seed tag %q: %v", name, err)
	}

	return tag.ID
}

// tagOn puts a tag on a restock straight in the table, as by nobody in particular.
func tagOn(t *testing.T, db *gorm.DB, restockID, tagID uint64) {
	t.Helper()

	err := db.Create(&inventory_service_models.RestockTag{RestockID: restockID, TagID: tagID, AddedAt: time.Now()}).Error
	if err != nil {
		t.Fatalf("tag %d on restock %d: %v", tagID, restockID, err)
	}
}

// appTagID is the id of the app's own tag for `task` — seeded by the migration.
func appTagID(t *testing.T, db *gorm.DB, task string) uint64 {
	t.Helper()

	var id uint64

	err := db.
		Model(&inventory_service_models.Tag{}).
		Select("id").
		Where("app_task = ?", task).
		Take(&id).
		Error
	if err != nil {
		t.Fatalf("the app's %q tag: %v", task, err)
	}

	return id
}

// exportTag is the id of the tag carrying `name` (any case).
func exportTag(t *testing.T, db *gorm.DB, name string) uint64 {
	t.Helper()

	var id uint64

	err := db.
		Model(&inventory_service_models.Tag{}).
		Select("id").
		Where("lower(name) = lower(?)", name).
		Take(&id).
		Error
	if err != nil {
		t.Fatalf("tag %q: %v", name, err)
	}

	return id
}

// tagNames is a restock's tags as their names, in the order read.
func tagNames(tags []*inventoryv1.RestockTag) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		out = append(out, tag.GetName())
	}

	return out
}

// tagRowsOf is how many rows of `restock_tags` the restock has, read from the table itself.
func tagRowsOf(t *testing.T, db *gorm.DB, restockID uint64) int64 {
	t.Helper()

	var n int64

	err := db.
		Model(&inventory_service_models.RestockTag{}).
		Where("restock_id = ?", restockID).
		Count(&n).
		Error
	if err != nil {
		t.Fatalf("count tags of %d: %v", restockID, err)
	}

	return n
}
