package warehouse_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A warehouse that never set its fee reads an ABSENT fee — the state that takes no orders — and after a save, its own.
func TestWarehouseFeeDetail_AbsentThenItsOwn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	res, err := svc.WarehouseFeeDetail(ctx, connect.NewRequest(&warehousev1.WarehouseFeeDetailRequest{TeamId: gudangA}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if res.Msg.Fee != nil {
		t.Fatalf("fee = %+v, want absent", res.Msg.GetFee())
	}

	setFee(t, svc, gudangA, 2.5, 2_000, 0)
	setFee(t, svc, 14, 1, 0, 0) // another warehouse's, never Gudang A's answer

	res, err = svc.WarehouseFeeDetail(ctx, connect.NewRequest(&warehousev1.WarehouseFeeDetailRequest{TeamId: gudangA}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	got := res.Msg.GetFee()
	if got.GetWarehouseId() != gudangA || got.GetFeePercent() != 2.5 || got.GetMinFee() != 2_000 || got.MaxFee != nil {
		t.Fatalf("fee = %+v", got)
	}
}
