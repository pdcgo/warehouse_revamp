package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// seedLegacySupplier writes a row into inventory_service's legacy_suppliers — the table the move reads.
func seedLegacySupplier(t *testing.T, db *gorm.DB, teamID uint64, code, name, contact, address, city, province string, deleted bool) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(
		`INSERT INTO legacy_suppliers (team_id, code, name, contact, address, city, province, deleted)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		teamID, code, name, contact, address, city, province, deleted,
	).Scan(&id).Error
	if err != nil {
		t.Fatalf("seed legacy supplier: %v", err)
	}

	return id
}

func seedLegacyChannel(t *testing.T, db *gorm.DB, supplierID uint64, kind, marketplace, name, url, contact, location string) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(
		`INSERT INTO legacy_supplier_channels (supplier_id, type, marketplace, name, url, contact, location)
		 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		supplierID, kind, marketplace, name, url, contact, location,
	).Scan(&id).Error
	if err != nil {
		t.Fatalf("seed legacy store: %v", err)
	}

	return id
}

type movedRow struct {
	ID          uint64
	TeamID      uint64
	Name        string
	Contact     string
	Address     string
	Description string
	Deleted     bool
}

func movedSupplierRow(t *testing.T, db *gorm.DB, id uint64) movedRow {
	t.Helper()

	var row movedRow

	err := db.Raw(
		`SELECT id, team_id, name, contact, address, description, deleted_at IS NOT NULL AS deleted
		 FROM suppliers WHERE id = ?`, id,
	).Scan(&row).Error
	if err != nil || row.ID == 0 {
		t.Fatalf("supplier %d was not moved (err %v)", id, err)
	}

	return row
}

// existing-suppliers-move-with-their-ids — the ids are kept, and nothing typed is lost on the way.
func TestSupplierMove_KeepsIdsAndFolds(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	live := seedLegacySupplier(t, db, 12, "SUP-1", "Sumber", "", "Jl. 1", "Bandung", "Jawa Barat", false)
	online := seedLegacyChannel(t, db, live, "online", "shopee", "Sumber Official", "https://shopee.example/sumber", "", "")
	seedLegacyChannel(t, db, live, "offline", "", "Toko Pasar", "", "0812-1111", "Pasar Baru Blok A")
	noMarket := seedLegacyChannel(t, db, live, "online", "", "Website", "https://sumber.example", "wa 0813", "")
	gone := seedLegacySupplier(t, db, 12, "SUP-2", "Retired", "0819", "", "", "", true)

	report, err := san.MoveSuppliers(context.Background())
	if err != nil {
		t.Fatalf("MoveSuppliers: %v", err)
	}

	if report.suppliersMoved != 2 || report.deletedMoved != 1 || report.storesMoved != 2 || report.offlineFolded != 1 {
		t.Fatalf("report = %+v", report)
	}

	// City and province join the address; the offline store's contact fills the empty contact, and its
	// location — the address being taken — goes to the description.
	got := movedSupplierRow(t, db, live)
	if got.TeamID != 12 || got.Name != "Sumber" || got.Address != "Jl. 1, Bandung, Jawa Barat" || got.Contact != "0812-1111" {
		t.Fatalf("moved supplier = %+v", got)
	}

	if !strings.Contains(got.Description, "Toko Pasar: Pasar Baru Blok A") {
		t.Fatalf("the offline store's location was lost: description %q", got.Description)
	}

	if retired := movedSupplierRow(t, db, gone); !retired.Deleted {
		t.Fatal("a deleted supplier must move marked deleted")
	}

	var stores []struct {
		ID          uint64
		ChannelType string
		URI         string `gorm:"column:uri"`
		Description string
	}

	err = db.Raw(`SELECT id, channel_type, uri, description FROM supplier_channels WHERE supplier_id = ? ORDER BY id`, live).
		Scan(&stores).Error
	if err != nil {
		t.Fatalf("read moved stores: %v", err)
	}

	if len(stores) != 2 || stores[0].ID != online || stores[0].ChannelType != "shopee" || stores[0].URI != "https://shopee.example/sumber" {
		t.Fatalf("moved stores = %+v", stores)
	}

	if stores[1].ID != noMarket || stores[1].ChannelType != "other" || stores[1].Description != "wa 0813" {
		t.Fatalf("an online store with no marketplace must move as other, its contact kept: %+v", stores[1])
	}

	// The sequence resumes past the moved ids — a new supplier never takes one of them.
	var next uint64

	err = db.Raw(`INSERT INTO suppliers (team_id, name) VALUES (12, 'New') RETURNING id`).Scan(&next).Error
	if err != nil {
		t.Fatalf("insert after move: %v", err)
	}

	if next <= gone || next <= live {
		t.Fatalf("a new supplier got id %d, at or below a moved one", next)
	}
}

// Run twice, the second run writes nothing and fails nothing.
func TestSupplierMove_RunsTwice(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	id := seedLegacySupplier(t, db, 12, "SUP-1", "Sumber", "", "", "", "", false)
	seedLegacyChannel(t, db, id, "online", "tiktok", "Sumber", "", "", "")

	_, err := san.MoveSuppliers(context.Background())
	if err != nil {
		t.Fatalf("first move: %v", err)
	}

	report, err := san.MoveSuppliers(context.Background())
	if err != nil {
		t.Fatalf("second move: %v", err)
	}

	if report.suppliersMoved != 0 || report.suppliersAlreadyThere != 1 || report.storesMoved != 0 || report.storesAlreadyThere != 1 {
		t.Fatalf("second move report = %+v", report)
	}
}

// A supplier created in supplier_service before the move may hold an id a legacy row needs — the move is
// refused whole, the clash named, and nothing written.
func TestSupplierMove_RefusesAClash(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	clashing := seedLegacySupplier(t, db, 12, "SUP-1", "Sumber", "", "", "", "", false)
	other := seedLegacySupplier(t, db, 12, "SUP-2", "Other", "", "", "", "", false)

	err := db.Exec(`INSERT INTO suppliers (id, team_id, name) VALUES (?, 13, 'Born Too Early')`, clashing).Error
	if err != nil {
		t.Fatalf("seed the clash: %v", err)
	}

	_, err = san.MoveSuppliers(context.Background())
	if !errors.Is(err, errMoveCollision) {
		t.Fatalf("move over a clash = %v, want errMoveCollision", err)
	}

	var n int64

	err = db.Raw(`SELECT count(*) FROM suppliers WHERE id = ?`, other).Scan(&n).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if n != 0 {
		t.Fatal("a refused move must write nothing — the clash-free supplier was moved anyway")
	}
}
