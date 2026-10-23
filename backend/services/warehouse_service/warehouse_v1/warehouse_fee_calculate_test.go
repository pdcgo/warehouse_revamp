package warehouse_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

func calculate(svc *warehouse_v1.Service, warehouseID uint64, goodsCost float64) (*warehousev1.WarehouseFeeCalculateResponse, error) {
	res, err := svc.WarehouseFeeCalculate(context.Background(), connect.NewRequest(&warehousev1.WarehouseFeeCalculateRequest{
		TeamId: 12, OrderTotal: goodsCost, WarehouseId: warehouseID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// THE DECIDED FORMULA, on the decisions' own worked examples (the-fee-has-a-floor-and-a-cap): 2.5%, floor 2 000,
// cap 20 000.
func TestWarehouseFeeCalculate_TheFloorThePercentAndTheCap(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setFee(t, svc, gudangA, 2.5, 2_000, 20_000)

	for _, c := range []struct {
		goods, want float64
		why         string
	}{
		{10_000, 2_000, "2.5% is 250 — the floor"},
		{172_000, 4_300, "2.5%"},
		{2_000_000, 20_000, "2.5% is 50 000 — the cap"},
	} {
		got, err := calculate(svc, gudangA, c.goods)
		if err != nil {
			t.Fatalf("calculate(%v): %v", c.goods, err)
		}

		if got.GetCalculatedWarehouseFee() != c.want {
			t.Fatalf("goods %v → fee %v, want %v (%s)", c.goods, got.GetCalculatedWarehouseFee(), c.want, c.why)
		}

		// The rate it used travels with it, so a charge can be explained later.
		if got.GetFeePercent() != 2.5 || got.GetMinFee() != 2_000 || got.GetMaxFee() != 20_000 || got.GetOrderTotal() != c.goods {
			t.Fatalf("the response does not echo the rate: %+v", got)
		}
	}
}

// AN EMPTY CAP IS NO CAP (an-empty-cap-means-no-cap), and a floor equal to the cap is a flat fee.
func TestWarehouseFeeCalculate_NoCapAndAFlatFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setFee(t, svc, gudangA, 2.5, 2_000, 0) // empty cap

	got, err := calculate(svc, gudangA, 2_000_000)
	if err != nil {
		t.Fatalf("calculate: %v", err)
	}

	if got.GetCalculatedWarehouseFee() != 50_000 || got.MaxFee != nil {
		t.Fatalf("uncapped: fee %v, cap %v — want 50 000 and no cap", got.GetCalculatedWarehouseFee(), got.MaxFee)
	}

	// Today's flat fee carried over: 0%, floor = cap (the-fee-has-a-floor-and-a-cap).
	setFee(t, svc, gudangA, 0, 5_000, 5_000)

	for _, goods := range []float64{0, 172_000, 2_000_000} {
		got, err = calculate(svc, gudangA, goods)
		if err != nil {
			t.Fatalf("calculate: %v", err)
		}

		if got.GetCalculatedWarehouseFee() != 5_000 {
			t.Fatalf("flat fee on %v goods = %v, want 5 000", goods, got.GetCalculatedWarehouseFee())
		}
	}
}

// A WAREHOUSE THAT NEVER SET ITS FEE GETS NO NUMBER (a-warehouse-with-no-rate-takes-no-orders): FailedPrecondition,
// naming it. 0% is a rate, and gets 0.
func TestWarehouseFeeCalculate_NoRateIsRefusedZeroIsARate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := calculate(svc, gudangA, 172_000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "Gudang A has not set its fee") {
		t.Fatalf("no rate: err = %v, want FailedPrecondition naming Gudang A", err)
	}

	// A warehouse with no name to be had is still refused, by its id.
	_, err = calculate(svc, 999, 172_000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "warehouse 999") {
		t.Fatalf("unnamed warehouse: err = %v", err)
	}

	setFee(t, svc, gudangA, 0, 0, 0)

	got, err := calculate(svc, gudangA, 172_000)
	if err != nil || got.GetCalculatedWarehouseFee() != 0 {
		t.Fatalf("0%%: fee %v, err %v — want 0, no error", got.GetCalculatedWarehouseFee(), err)
	}
}
