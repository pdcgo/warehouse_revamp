package inventory_v1_test

import (
	"context"
	"reflect"
	"slices"
	"testing"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE GUDANG FILTER'S SEAM (SupplierIDsAtWarehouse): the suppliers whose goods were received at a warehouse — exactly
// the ones whose page lists it among Gudang terkait (SupplierGoods by WAREHOUSE), so the list's filter and the chips
// never disagree (the-warehouse-filters-before-the-team, the-warehouse-filter-narrows-only-the-rows).

const (
	saGudang7 uint64 = 7 // Sumber's goods only by a transfer, still on the shelf
	saGudang8 uint64 = 8 // Sinar Jaya's goods by a transfer, moved on unsold — no chip
	saGudang9 uint64 = 9 // Sinar Jaya's goods by a transfer, sold out of it
)

// saTransferIn mints a batch at `warehouse` the way a transfer's accept does — a `transfer_in` transaction, the
// supplier copied from the source batch — holding `ready` units, and returns it.
func saTransferIn(t *testing.T, f sgFixture, warehouse, team, product, supplier uint64, ready int64) uint64 {
	t.Helper()

	var txID uint64

	err := f.db.Raw(`
		INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		VALUES (?, ?, 'transfer_in', NOW(), NOW()) RETURNING id`, warehouse, team).Scan(&txID).Error
	if err != nil {
		t.Fatalf("seed transfer: %v", err)
	}

	var batchID uint64

	err = f.db.Raw(`
		INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                     init_stock_count, init_stock_valuation, supplier_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, 10000, ?, ?, 3, 30000, ?, NOW(), NOW()) RETURNING id`,
		warehouse, team, product, txID, ready, float64(ready)*10000, supplier).Scan(&batchID).Error
	if err != nil {
		t.Fatalf("seed transferred batch: %v", err)
	}

	return batchID
}

// saSoldFrom writes an order's take row on a batch — what a sale out of it leaves in batch_logs.
func saSoldFrom(t *testing.T, f sgFixture, warehouse, team, batchID uint64, units int64) {
	t.Helper()

	var txID uint64

	err := f.db.Raw(`
		INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		VALUES (?, ?, 'order', NOW(), NOW()) RETURNING id`, warehouse, team).Scan(&txID).Error
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}

	err = f.db.Exec(`
		INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                        stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		VALUES (?, ?, ?, ?, 'order', ?, ?, 0, 0, 10000, '', 1, NOW())`,
		warehouse, team, batchID, txID, -units, float64(-units)*10000).Error
	if err != nil {
		t.Fatalf("seed take row: %v", err)
	}
}

// Every way a warehouse comes to hold a supplier's goods, and the one way it holds none: a restock (two teams' at
// Gudang 5), a restock batch emptied since (Gudang 6), a transfer still on the shelf (7), a transfer moved on unsold (8),
// a transfer sold out of (9). For each warehouse the answer equals the suppliers SupplierGoods lists it for; a batch
// from nobody (Topi) is never a supplier.
func TestSupplierIDsAtWarehouse_TheSuppliersOfTheChips(t *testing.T) {
	f := sgStocked(t)
	ctx := context.Background()

	// Gudang 6's only batch of Sumber's, written down to 0 — it was still received there.
	err := f.db.Exec("UPDATE batches SET stock_count = 0, stock_valuation = 0 WHERE warehouse_id = ? AND supplier_id = ?",
		sgGudang6, sgSumber).Error
	if err != nil {
		t.Fatalf("empty Gudang 6: %v", err)
	}

	saTransferIn(t, f, saGudang7, sgSinar, sgCelana, sgSumber, 2)
	saTransferIn(t, f, saGudang8, sgSinar, sgCelana, sgSinarJaya, 0)
	sold := saTransferIn(t, f, saGudang9, sgSinar, sgCelana, sgSinarJaya, 0)
	saSoldFrom(t, f, saGudang9, sgSinar, sold, 3)

	ours := []uint64{sgSumber, sgSinarJaya, sgNobody}

	// The chips: every (supplier, warehouse) row SupplierGoods answers for our three.
	chips := map[uint64][]uint64{}
	for _, row := range sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, ours...) {
		chips[row.GetWarehouseId()] = append(chips[row.GetWarehouseId()], row.GetSupplierId())
	}

	cases := []struct {
		name      string
		warehouse uint64
		want      []uint64
	}{
		{"Gudang 5 — restocked by two teams", sgGudang5, []uint64{sgSumber, sgSinarJaya}},
		{"Gudang 6 — restocked, emptied since", sgGudang6, []uint64{sgSumber}},
		{"Gudang 7 — a transfer on the shelf", saGudang7, []uint64{sgSumber}},
		{"Gudang 8 — a transfer moved on unsold", saGudang8, nil},
		{"Gudang 9 — a transfer sold out of", saGudang9, []uint64{sgSinarJaya}},
	}

	for _, c := range cases {
		all, err := inventory_v1.SupplierIDsAtWarehouse(ctx, f.db, c.warehouse)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if slices.Contains(all, 0) {
			t.Fatalf("%s: supplier 0 (goods from nobody) came back in %v", c.name, all)
		}

		if !slices.IsSorted(all) {
			t.Fatalf("%s: %v is not in id order", c.name, all)
		}

		var got []uint64

		for _, id := range all {
			if slices.Contains(ours, id) {
				got = append(got, id)
			}
		}

		if !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s = %v, want %v", c.name, got, c.want)
		}

		chipped := slices.Clone(chips[c.warehouse])
		slices.Sort(chipped)

		if !reflect.DeepEqual(got, chipped) {
			t.Fatalf("%s: the filter keeps %v but the chips list %v", c.name, got, chipped)
		}
	}
}
