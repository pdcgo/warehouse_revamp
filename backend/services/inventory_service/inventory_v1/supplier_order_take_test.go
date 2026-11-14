package inventory_v1_test

import (
	"context"
	"reflect"
	"testing"

	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE SALES FOLD'S SEAM (OrderTakeSuppliers): what an order's take drew, per supplier, product, owning team and the
// warehouse it was taken from (the-supplier-reports-carry-the-warehouse) — read by
// supplier_service when the order is placed or cancelled (penjualan-is-the-selling-value-on-the-order-day).

// A take spanning two suppliers' batches of one product splits by batch; a batch bought from nobody is left out; the
// owning team is the batch's, not the caller's; the warehouse is the batches' — the one the take drew in.
func TestOrderTakeSuppliers_SplitsByTheBatchesTheTakeDrew(t *testing.T) {
	f := sgStocked(t)

	celana := sgSell(t, f, sgSinar, sgGudang5, sgCelana, 9, "ots-1") // 8 from Sumber's batch first (FIFO), 1 from Sinar Jaya's
	topi := sgSell(t, f, sgMelati, sgGudang5, sgTopi, 2, "ots-2")    // bought from nobody

	got, err := f.svc.OrderTakeSuppliers(context.Background(), celana)
	if err != nil {
		t.Fatalf("OrderTakeSuppliers: %v", err)
	}

	want := []inventory_v1.OrderTakeSupplier{
		{ProductID: sgCelana, SupplierID: sgSumber, TeamID: sgSinar, WarehouseID: sgGudang5, Units: 8},
		{ProductID: sgCelana, SupplierID: sgSinarJaya, TeamID: sgSinar, WarehouseID: sgGudang5, Units: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Celana's take = %+v, want %+v", got, want)
	}

	got, err = f.svc.OrderTakeSuppliers(context.Background(), topi)
	if err != nil {
		t.Fatalf("OrderTakeSuppliers: %v", err)
	}

	if len(got) != 0 {
		t.Fatalf("a take from a batch bought from nobody = %+v, want none", got)
	}
}

// After the release the take still reads what it drew — the rollback rows are not subtracted — so a placement folded
// after its cancel counts the same units its cancel takes back. Transaction 0 reads nothing.
func TestOrderTakeSuppliers_ReadsTheTakeGrossAfterItsRelease(t *testing.T) {
	f := sgStocked(t)

	tx := sgSell(t, f, sgMelati, sgGudang5, sgKaos, 3, "ots-3")
	sgCancel(t, f, sgMelati, "ots-3")

	got, err := f.svc.OrderTakeSuppliers(context.Background(), tx)
	if err != nil {
		t.Fatalf("OrderTakeSuppliers: %v", err)
	}

	want := []inventory_v1.OrderTakeSupplier{{ProductID: sgKaos, SupplierID: sgSumber, TeamID: sgMelati, WarehouseID: sgGudang5, Units: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("released take = %+v, want %+v", got, want)
	}

	got, err = f.svc.OrderTakeSuppliers(context.Background(), 0)
	if err != nil || len(got) != 0 {
		t.Fatalf("transaction 0 = %+v, %v — want nothing", got, err)
	}
}
