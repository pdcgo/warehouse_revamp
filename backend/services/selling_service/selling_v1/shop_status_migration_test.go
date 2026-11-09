package selling_v1_test

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE MIGRATION'S FILL (a-shop-is-closed-never-deleted: "shops already deleted become closed, closed_at = their
// updated_at"), run for real: inside this test's transaction the migration's Down puts `deleted` back, rows are written
// the old way — a deleted shop, a live one, and a deleted shop whose code a live one took after the delete — and the
// migration's Up turns them over. All of it rolls back with the test.
func TestShopStatusMigration_DeletedShopsBecomeClosed(t *testing.T) {
	db := san_testdb.DB(t)

	raw, err := os.ReadFile("../db_migrations/00043_shop_status_replaces_deleted.sql")
	if err != nil {
		t.Fatalf("the migration: %v", err)
	}

	parts := strings.SplitN(string(raw), "-- +goose Down", 2)
	if len(parts) != 2 {
		t.Fatal("the migration has no Down")
	}

	up, down := parts[0], parts[1]

	err = db.Exec(down).Error
	if err != nil {
		t.Fatalf("run the migration's Down: %v", err)
	}

	deletedAt := time.Date(2026, 10, 3, 9, 30, 0, 0, time.UTC)

	// A team of its own, so a committed row another run left behind is never counted.
	const team = 8_800_043

	type seed struct {
		code    string
		deleted bool
	}

	ids := map[string]uint64{}

	for _, s := range []seed{{"GONE", true}, {"LIVE", false}, {"REUSED", true}} {
		var id uint64

		err = db.Raw(`INSERT INTO shops (team_id, name, shop_code, marketplace, deleted, updated_at)
			VALUES (?, ?, ?, 'shopee', ?, ?) RETURNING id`, team, "Toko "+s.code, s.code, s.deleted, deletedAt).
			Scan(&id).
			Error
		if err != nil {
			t.Fatalf("seed %s the old way: %v", s.code, err)
		}

		ids[s.code] = id
	}

	// The code a deleted shop freed, taken by a live one after the delete — the migration rewrites no codes.
	err = db.Exec(`INSERT INTO shops (team_id, name, shop_code, marketplace) VALUES (?, 'Toko Baru', 'REUSED', 'shopee')`, team).Error
	if err != nil {
		t.Fatalf("seed the code's new holder: %v", err)
	}

	err = db.Exec(up).Error
	if err != nil {
		t.Fatalf("run the migration's Up: %v", err)
	}

	type row struct {
		ID       uint64
		ShopCode string
		Status   string
		ClosedAt *time.Time
	}

	var rows []row

	err = db.Raw(`SELECT id, shop_code, status, closed_at FROM shops WHERE team_id = ? ORDER BY id`, team).Scan(&rows).Error
	if err != nil {
		t.Fatalf("read the shops back: %v", err)
	}

	if len(rows) != 4 {
		t.Fatalf("%d shops after the migration, want the 4 seeded — none deleted", len(rows))
	}

	for _, r := range rows {
		switch r.ID {
		case ids["GONE"], ids["REUSED"]:
			if r.Status != "closed" || r.ClosedAt == nil || !r.ClosedAt.Equal(deletedAt) {
				t.Errorf("deleted shop %s: status %q closed at %v — want closed at its updated_at %v",
					r.ShopCode, r.Status, r.ClosedAt, deletedAt)
			}
		default:
			if r.Status != "open" || r.ClosedAt != nil {
				t.Errorf("live shop %d (%s): status %q closed at %v — want open with no date", r.ID, r.ShopCode, r.Status, r.ClosedAt)
			}
		}

		if r.ShopCode == "" {
			t.Errorf("shop %d lost its code", r.ID)
		}
	}

	// The column is gone and the open-only unique index holds: a second OPEN shop on a held code is refused.
	err = db.Exec(`SAVEPOINT clash`).Error
	if err != nil {
		t.Fatalf("savepoint: %v", err)
	}

	err = db.Exec(`INSERT INTO shops (team_id, name, shop_code, marketplace) VALUES (?, 'Toko Dua', 'LIVE', 'shopee')`, team).Error
	if err == nil {
		t.Fatal("a second open shop on LIVE was stored — the unique index among open shops is missing")
	}

	err = db.Exec(`ROLLBACK TO SAVEPOINT clash`).Error
	if err != nil {
		t.Fatalf("rollback to savepoint: %v", err)
	}

	var hasDeleted bool

	err = db.Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_name = 'shops' AND column_name = 'deleted' AND table_schema = current_schema())`).
		Scan(&hasDeleted).
		Error
	if err != nil || hasDeleted {
		t.Fatalf("shops.deleted still there after the Up (%v)", err)
	}
}
