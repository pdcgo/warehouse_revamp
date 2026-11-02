package main

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The REAL history product_service's Delete asks (a-used-product-is-archived-never-deleted): a product nothing names
// has none; a product registered at a warehouse (inventory), or named by a return map (the order side), has one.
func TestProductHistory_AsksInventoryAndTheOrderSide(t *testing.T) {
	db := san_testdb.DB(t)
	history := NewProductHistory(db)

	const fresh, stocked, mapped uint64 = 910_001, 910_002, 910_003

	err := db.Exec(`INSERT INTO warehouse_products (warehouse_id, product_id) VALUES (11, ?)`, stocked).Error
	if err != nil {
		t.Fatalf("register at a warehouse: %v", err)
	}

	err = db.Exec(`INSERT INTO product_return_maps (team_id, shared_product_id, own_product_id) VALUES (12, ?, 910_999)`, mapped).Error
	if err != nil {
		t.Fatalf("map a return: %v", err)
	}

	for id, want := range map[uint64]bool{fresh: false, stocked: true, mapped: true} {
		got, err := history.ProductHasHistory(context.Background(), id)
		if err != nil {
			t.Fatalf("product %d: %v", id, err)
		}

		if got != want {
			t.Fatalf("product %d has history %v, want %v", id, got, want)
		}
	}
}
