package warehouse_v1_test

import (
	"context"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A SECOND SAVE REPLACES THE FIRST on the same row — one rate per warehouse (one-rate-per-warehouse) — and an emptied
// cap is CLEARED, not left as it was.
func TestWarehouseFeeSet_ReplacesAndClearsTheCap(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := setFee(t, svc, gudangA, 2.5, 2_000, 20_000)
	if first.GetMaxFee() != 20_000 {
		t.Fatalf("first save: %+v", first)
	}

	second := setFee(t, svc, gudangA, 3, 1_000, 0)
	if second.GetFeePercent() != 3 || second.GetMinFee() != 1_000 || second.MaxFee != nil {
		t.Fatalf("second save = %+v — want 3%%, floor 1 000, no cap", second)
	}

	var rows int64

	err := db.Raw(`SELECT count(*) FROM warehouse_fees WHERE warehouse_id = ?`, gudangA).Scan(&rows).Error
	if err != nil || rows != 1 {
		t.Fatalf("rows = %d (%v), want one per warehouse", rows, err)
	}
}

// A FLOOR ABOVE THE CAP IS REFUSED; equal is a flat fee (the-fee-has-a-floor-and-a-cap).
func TestWarehouseFeeSet_AFloorAboveTheCapIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.WarehouseFeeSet(context.Background(), connect.NewRequest(&warehousev1.WarehouseFeeSetRequest{
		TeamId: gudangA, FeePercent: 2.5, MinFee: 30_000, MaxFee: proto.Float64(20_000),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("floor above cap: %v, want InvalidArgument", err)
	}

	flat := setFee(t, svc, gudangA, 0, 5_000, 5_000)
	if flat.GetMinFee() != 5_000 || flat.GetMaxFee() != 5_000 {
		t.Fatalf("a flat fee was refused: %+v", flat)
	}
}

// THE CONTRACT REFUSES what the handler never sees (an-empty-cap-means-no-cap): a cap of 0, a percent outside 0–100,
// a negative floor.
func TestWarehouseFeeSet_TheContractRefusesACapOfZero(t *testing.T) {
	v, err := protovalidate.New()
	if err != nil {
		t.Fatalf("protovalidate.New: %v", err)
	}

	for name, req := range map[string]*warehousev1.WarehouseFeeSetRequest{
		"a cap of 0":       {TeamId: gudangA, FeePercent: 2.5, MaxFee: proto.Float64(0)},
		"over 100%":        {TeamId: gudangA, FeePercent: 101},
		"a negative floor": {TeamId: gudangA, FeePercent: 2.5, MinFee: -1},
	} {
		if v.Validate(req) == nil {
			t.Fatalf("%s was accepted", name)
		}
	}

	if err = v.Validate(&warehousev1.WarehouseFeeSetRequest{TeamId: gudangA, FeePercent: 0}); err != nil {
		t.Fatalf("0%% with no floor and no cap — a warehouse charging nothing — was refused: %v", err)
	}
}
