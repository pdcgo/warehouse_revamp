package warehouse_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// The warehouses the carry-over tests use beside gudangA.
const (
	gudangB uint64 = 12
	gudangC uint64 = 13
)

func carryOver(t *testing.T, svc *warehouse_v1.Service, fees ...warehouse_v1.FlatFee) warehouse_v1.CarryOverResult {
	t.Helper()

	result, err := svc.CarryOverFlatFees(context.Background(), fees)
	if err != nil {
		t.Fatalf("CarryOverFlatFees: %v", err)
	}

	return result
}

// feeOf is the warehouse's saved rate, or nil when it has none.
func feeOf(t *testing.T, svc *warehouse_v1.Service, warehouseID uint64) *warehousev1.WarehouseFee {
	t.Helper()

	res, err := svc.WarehouseFeeDetail(context.Background(), connect.NewRequest(&warehousev1.WarehouseFeeDetailRequest{
		TeamId: warehouseID,
	}))
	if err != nil {
		t.Fatalf("WarehouseFeeDetail(%d): %v", warehouseID, err)
	}

	return res.Msg.GetFee()
}

// A FLAT FEE CARRIES OVER EXACTLY — 0%, floor = cap = the flat fee ("today's flat fee" in the-fee-has-a-floor-and-a-cap)
// — so a seller on the default pays the same 12 000 on the switch-over day, on a small order and a big one.
func TestCarryOverFlatFees_AFlatFeeIsAFloorEqualToTheCap(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	result := carryOver(t, svc, warehouse_v1.FlatFee{WarehouseID: gudangA, Fee: 12_000})
	if result.Carried != 1 || result.Skipped != 0 {
		t.Fatalf("result = %+v, want 1 carried", result)
	}

	fee := feeOf(t, svc, gudangA)
	if fee.GetFeePercent() != 0 || fee.GetMinFee() != 12_000 || fee.MaxFee == nil || fee.GetMaxFee() != 12_000 {
		t.Fatalf("carried %+v — want 0%%, floor 12 000, cap 12 000", fee)
	}

	for _, goods := range []float64{0, 10_000, 2_000_000} {
		got, err := calculate(svc, gudangA, goods)
		if err != nil {
			t.Fatalf("calculate(%v): %v", goods, err)
		}

		if got.GetCalculatedWarehouseFee() != 12_000 {
			t.Fatalf("goods %v → %v, want the flat 12 000", goods, got.GetCalculatedWarehouseFee())
		}
	}
}

// A FLAT FEE OF 0 IS 0% WITH NO FLOOR AND NO CAP — never a cap of 0, which the table refuses
// (an-empty-cap-means-no-cap). It charges nothing, and it is still a rate: the warehouse is priced, not refused
// (a-warehouse-with-no-rate-takes-no-orders).
func TestCarryOverFlatFees_ZeroIsZeroPercentWithNoCap(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	result := carryOver(t, svc, warehouse_v1.FlatFee{WarehouseID: gudangA, Fee: 0})
	if result.Carried != 1 {
		t.Fatalf("result = %+v, want 1 carried", result)
	}

	fee := feeOf(t, svc, gudangA)
	if fee == nil || fee.GetFeePercent() != 0 || fee.GetMinFee() != 0 || fee.MaxFee != nil {
		t.Fatalf("carried %+v — want 0%%, no floor, no cap", fee)
	}

	got, err := calculate(svc, gudangA, 172_000)
	if err != nil {
		t.Fatalf("a warehouse carried at 0 was refused: %v", err)
	}

	if got.GetCalculatedWarehouseFee() != 0 {
		t.Fatalf("fee = %v, want 0", got.GetCalculatedWarehouseFee())
	}
}

// THE RATE A WAREHOUSE SET ITSELF WINS. Gudang A set 2.5% before the carry-over ran: it keeps it, and only Gudang B,
// which had none, is carried.
func TestCarryOverFlatFees_NeverReplacesARate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setFee(t, svc, gudangA, 2.5, 2_000, 20_000)

	result := carryOver(t, svc,
		warehouse_v1.FlatFee{WarehouseID: gudangA, Fee: 12_000},
		warehouse_v1.FlatFee{WarehouseID: gudangB, Fee: 5_000},
	)
	if result.Carried != 1 || result.Skipped != 1 {
		t.Fatalf("result = %+v, want 1 carried, 1 skipped", result)
	}

	kept := feeOf(t, svc, gudangA)
	if kept.GetFeePercent() != 2.5 || kept.GetMinFee() != 2_000 || kept.GetMaxFee() != 20_000 {
		t.Fatalf("Gudang A's own rate was replaced: %+v", kept)
	}

	if carried := feeOf(t, svc, gudangB); carried.GetMinFee() != 5_000 || carried.GetMaxFee() != 5_000 {
		t.Fatalf("Gudang B = %+v, want its flat 5 000", carried)
	}
}

// A SECOND RUN CARRIES NOTHING AND SAYS SO — every warehouse is skipped, one row each, unchanged.
func TestCarryOverFlatFees_ASecondRunCarriesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fees := []warehouse_v1.FlatFee{
		{WarehouseID: gudangA, Fee: 12_000},
		{WarehouseID: gudangB, Fee: 0},
		{WarehouseID: gudangC, Fee: 8_000},
	}

	first := carryOver(t, svc, fees...)
	if first.Carried != 3 || first.Skipped != 0 {
		t.Fatalf("first run = %+v, want 3 carried", first)
	}

	second := carryOver(t, svc, fees...)
	if second.Carried != 0 || second.Skipped != 3 {
		t.Fatalf("second run = %+v, want 0 carried, 3 skipped", second)
	}

	if rows := countFees(t, db); rows != 3 {
		t.Fatalf("%d rows, want one per warehouse", rows)
	}

	// Nothing to carry is not an error.
	if empty := carryOver(t, svc); empty.Carried != 0 || empty.Skipped != 0 {
		t.Fatalf("an empty carry-over = %+v", empty)
	}
}

// A NEGATIVE FEE IS A CALLER'S BUG — liability's CHECK keeps handling_fee >= 0 — and nothing is written, not even the
// good row beside it.
func TestCarryOverFlatFees_ANegativeFeeIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.CarryOverFlatFees(context.Background(), []warehouse_v1.FlatFee{
		{WarehouseID: gudangA, Fee: 12_000},
		{WarehouseID: gudangB, Fee: -1},
	})
	if err == nil {
		t.Fatal("a negative flat fee was carried")
	}

	if rows := countFees(t, db); rows != 0 {
		t.Fatalf("%d rows written beside the refusal, want none", rows)
	}
}

func countFees(t *testing.T, db *gorm.DB) int64 {
	t.Helper()

	var rows int64

	err := db.
		Raw(`SELECT count(*) FROM warehouse_fees WHERE warehouse_id IN ?`, []uint64{gudangA, gudangB, gudangC}).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("count fees: %v", err)
	}

	return rows
}
