package warehouse_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// feeOf is the warehouse's saved rate, read through WarehouseFeeDetail, or nil when it has none.
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

// THE DEV FIXTURE'S WRITE NEVER REPLACES A RATE: it writes where there is none, and a second call — with other numbers —
// leaves the first standing and says it wrote nothing.
func TestWarehouseFeeSetIfAbsent_WritesOnlyWhereThereIsNone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	written, err := svc.WarehouseFeeSetIfAbsent(context.Background(), &warehousev1.WarehouseFeeSetRequest{
		TeamId: gudangA, FeePercent: 2.5, MinFee: 2_000, MaxFee: proto.Float64(20_000),
	})
	if err != nil || !written {
		t.Fatalf("first write: %v (written %v), want written", err, written)
	}

	written, err = svc.WarehouseFeeSetIfAbsent(context.Background(), &warehousev1.WarehouseFeeSetRequest{
		TeamId: gudangA, FeePercent: 9, MinFee: 1,
	})
	if err != nil || written {
		t.Fatalf("second write: %v (written %v), want nothing written", err, written)
	}

	fee := feeOf(t, svc, gudangA)
	if fee.GetFeePercent() != 2.5 || fee.GetMinFee() != 2_000 || fee.GetMaxFee() != 20_000 {
		t.Fatalf("the rate was replaced: %+v", fee)
	}
}

// THE SAME FLOOR-UNDER-CAP RULE AS WarehouseFeeSet (the-fee-has-a-floor-and-a-cap), and nothing is written.
func TestWarehouseFeeSetIfAbsent_AFloorAboveTheCapIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.WarehouseFeeSetIfAbsent(context.Background(), &warehousev1.WarehouseFeeSetRequest{
		TeamId: gudangA, FeePercent: 2.5, MinFee: 30_000, MaxFee: proto.Float64(20_000),
	})
	if err == nil {
		t.Fatal("a floor above the cap was written")
	}

	if fee := feeOf(t, svc, gudangA); fee != nil {
		t.Fatalf("a refused rate was saved: %+v", fee)
	}
}
