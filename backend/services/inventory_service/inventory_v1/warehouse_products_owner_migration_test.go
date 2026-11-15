package inventory_v1_test

import (
	"os"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The fill of inventory 00047 (the-warehouse-link-names-its-owner-team), run for real inside the test's transaction: its
// Down drops `owner_team_id`, a fixture of links and of the rows that name their products' owner is seeded, and its Up
// adds the column back filled. All of it rolls back with the test.

// ownerMigration is 00047's Up and Down, as goose runs them.
func ownerMigration(t *testing.T) (up, down string) {
	t.Helper()

	raw, err := os.ReadFile("../db_migrations/00047_warehouse_products_owner_team.sql")
	if err != nil {
		t.Fatalf("the migration: %v", err)
	}

	parts := strings.SplitN(string(raw), "-- +goose Down", 2)
	if len(parts) != 2 {
		t.Fatal("the migration has no Down")
	}

	return parts[0], parts[1]
}

// beforeOwnerColumn is the database as it was before 00047: its Down run, and no link left but the fixture's.
func beforeOwnerColumn(t *testing.T, db *gorm.DB) {
	t.Helper()

	_, down := ownerMigration(t)

	err := db.Exec(down).Error
	if err != nil {
		t.Fatalf("run the Down: %v", err)
	}

	if ownerColumnExists(t, db) {
		t.Fatal("the Down left owner_team_id on warehouse_products")
	}

	err = db.Exec(`DELETE FROM warehouse_products`).Error
	if err != nil {
		t.Fatalf("clear the links: %v", err)
	}
}

func ownerColumnExists(t *testing.T, db *gorm.DB) bool {
	t.Helper()

	var n int64

	db.Raw(`SELECT count(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'warehouse_products' AND column_name = 'owner_team_id'`).Scan(&n)

	return n == 1
}

// ownerFixture seeds the rows the fill reads, through plain inserts.
type ownerFixture struct {
	t  *testing.T
	db *gorm.DB
}

func (f ownerFixture) exec(sql string, args ...any) {
	f.t.Helper()

	err := f.db.Exec(sql, args...).Error
	if err != nil {
		f.t.Fatalf("seed %q: %v", sql, err)
	}
}

func (f ownerFixture) id(sql string, args ...any) uint64 {
	f.t.Helper()

	var id uint64

	err := f.db.Raw(sql, args...).Scan(&id).Error
	if err != nil || id == 0 {
		f.t.Fatalf("seed %q: id %d, %v", sql, id, err)
	}

	return id
}

func (f ownerFixture) link(warehouseID, productID uint64) {
	f.exec(`INSERT INTO warehouse_products (warehouse_id, product_id) VALUES (?, ?)`, warehouseID, productID)
}

// batch mints one batch of the product at the warehouse, owned by the team, with the stock line naming the same owner.
func (f ownerFixture) batch(warehouseID, teamID, productID uint64) {
	tx := f.id(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (?, ?, 'restock') RETURNING id`,
		warehouseID, teamID)

	f.exec(`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		init_stock_count, init_stock_valuation) VALUES (?, ?, ?, ?, 1000, 1, 1000, 1, 1000)`, warehouseID, teamID, productID, tx)
}

// item is a stock line naming the product's owner, with no batch (a transaction item alone).
func (f ownerFixture) item(warehouseID, ownerTeamID, productID uint64) {
	tx := f.id(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (?, ?, 'adjustment') RETURNING id`,
		warehouseID, ownerTeamID)

	f.exec(`INSERT INTO inventory_transaction_items (warehouse_id, transaction_id, product_id, product_team_id, is_owned,
		quantity, total) VALUES (?, ?, ?, ?, true, 1, 1000)`, warehouseID, tx, productID, ownerTeamID)
}

func (f ownerFixture) restock(warehouseID, teamID, productID uint64) {
	restock := f.id(`INSERT INTO restocks (team_id, warehouse_id) VALUES (?, ?) RETURNING id`, teamID, warehouseID)

	f.exec(`INSERT INTO restock_items (restock_id, product_id, product_code, name, count) VALUES (?, ?, 'SKU', 'Widget', 1)`,
		restock, productID)
}

func (f ownerFixture) transfer(fromID, toID, teamID, productID uint64) {
	transfer := f.id(`INSERT INTO warehouse_transfers (team_id, from_warehouse_id, to_warehouse_id, status)
		VALUES (?, ?, ?, 'created') RETURNING id`, teamID, fromID, toID)

	f.exec(`INSERT INTO warehouse_transfer_items (transfer_id, product_id, count) VALUES (?, ?, 1)`, transfer, productID)
}

const (
	moWarehouse1 uint64 = 61
	moWarehouse2 uint64 = 62
	moWarehouse3 uint64 = 63
)

// Every source fills its link with the product's owner: a batch, the restock that linked it, the transfer that did, a
// stock line — and a product linked at a warehouse where none of its rows sit (its restock was edited to another
// building) takes the owner its rows name elsewhere, since the owner is the product's. Sources that agree count once.
// After the fill the column is NOT NULL, above zero, and (warehouse, product) is still the key.
func TestWarehouseProductsOwnerMigration_FillsEachLinkWithItsProductsOwner(t *testing.T) {
	db := san_testdb.DB(t)
	beforeOwnerColumn(t, db)

	f := ownerFixture{t: t, db: db}

	f.link(moWarehouse1, 9101)
	f.batch(moWarehouse1, 12, 9101) // a batch here

	f.link(moWarehouse1, 9102)
	f.restock(moWarehouse1, 13, 9102) // asked for, never received

	f.link(moWarehouse2, 9103)
	f.transfer(moWarehouse1, moWarehouse2, 14, 9103) // on its way

	f.link(moWarehouse3, 9104)
	f.restock(moWarehouse1, 15, 9104) // its restock went to another building

	f.link(moWarehouse1, 9105)
	f.item(moWarehouse1, 16, 9105) // only a stock line names it

	f.link(moWarehouse1, 9106)
	f.link(moWarehouse2, 9106)
	f.batch(moWarehouse1, 17, 9106) // every source agrees
	f.restock(moWarehouse2, 17, 9106)
	f.transfer(moWarehouse1, moWarehouse2, 17, 9106)
	f.item(moWarehouse2, 17, 9106)

	up, _ := ownerMigration(t)

	err := db.Exec(up).Error
	if err != nil {
		t.Fatalf("run the Up: %v", err)
	}

	type row struct {
		WarehouseID, ProductID, OwnerTeamID uint64
	}

	var rows []row

	db.Raw(`SELECT warehouse_id, product_id, owner_team_id FROM warehouse_products ORDER BY product_id, warehouse_id`).Scan(&rows)

	want := []row{
		{moWarehouse1, 9101, 12}, {moWarehouse1, 9102, 13}, {moWarehouse2, 9103, 14}, {moWarehouse3, 9104, 15},
		{moWarehouse1, 9105, 16}, {moWarehouse1, 9106, 17}, {moWarehouse2, 9106, 17},
	}

	if len(rows) != len(want) {
		t.Fatalf("%d links after the fill, want %d: %+v", len(rows), len(want), rows)
	}

	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("link %d = %+v, want %+v (all: %+v)", i, rows[i], want[i], rows)
		}
	}

	// refused runs one statement in a savepoint and says whether the database refused it.
	refused := func(sql string, args ...any) bool {
		return db.Transaction(func(tx *gorm.DB) error {
			return tx.Exec(sql, args...).Error
		}) != nil
	}

	link := `INSERT INTO warehouse_products (warehouse_id, product_id, owner_team_id) VALUES (?, ?, ?)`

	if !refused(`INSERT INTO warehouse_products (warehouse_id, product_id) VALUES (?, 9201)`, moWarehouse1) {
		t.Fatal("a link with no owner was let in — the column is not NOT NULL")
	}

	if !refused(link, moWarehouse1, 9202, 0) {
		t.Fatal("a link under team 0 was let in")
	}

	if !refused(link, moWarehouse1, 9101, 99) {
		t.Fatal("a second link of one product at one warehouse, under another team, was let in — the key split")
	}

	if refused(link, moWarehouse1, 9203, 12) {
		t.Fatal("a new link with an owner was refused")
	}

	var temp int64

	db.Raw(`SELECT count(*) FROM pg_class WHERE relname = 'warehouse_product_owners'`).Scan(&temp)
	if temp != 0 {
		t.Fatal("the fill's working table outlived the migration")
	}
}

// A link the fill cannot give ONE owner refuses the whole migration, naming it — nothing changes: two teams' rows naming
// one product (a product has one owner, so either would be a guess), or no row naming it at all.
func TestWarehouseProductsOwnerMigration_RefusesALinkWithoutOneOwner(t *testing.T) {
	for name, tc := range map[string]struct {
		seed func(f ownerFixture)
		says string
	}{
		"two owners": {
			seed: func(f ownerFixture) {
				f.link(moWarehouse1, 9301)
				f.batch(moWarehouse1, 12, 9301)
				f.restock(moWarehouse2, 13, 9301)
			},
			says: "named by two teams: product 9301 at warehouse 61 (teams 12 and 13)",
		},
		"no owner": {
			seed: func(f ownerFixture) {
				f.link(moWarehouse2, 9302)
			},
			says: "no inventory row names an owner: product 9302 at warehouse 62",
		},
	} {
		t.Run(name, func(t *testing.T) {
			db := san_testdb.DB(t)
			beforeOwnerColumn(t, db)

			f := ownerFixture{t: t, db: db}

			// One link that does fill — the refusal is the whole migration's, not the bad row's alone.
			f.link(moWarehouse3, 9300)
			f.batch(moWarehouse3, 12, 9300)

			tc.seed(f)

			up, _ := ownerMigration(t)

			err := db.Transaction(func(tx *gorm.DB) error {
				return tx.Exec(up).Error
			})
			if err == nil {
				t.Fatal("the migration filled a link without one owner")
			}

			if !strings.Contains(err.Error(), tc.says) || !strings.Contains(err.Error(), "the-warehouse-link-names-its-owner-team") {
				t.Fatalf("the refusal %q does not say %q", err, tc.says)
			}

			if ownerColumnExists(t, db) {
				t.Fatal("a refused migration left owner_team_id behind")
			}

			var links int64

			db.Raw(`SELECT count(*) FROM warehouse_products`).Scan(&links)
			if links < 2 {
				t.Fatalf("%d links after the refusal, want the fixture's untouched", links)
			}
		})
	}
}
