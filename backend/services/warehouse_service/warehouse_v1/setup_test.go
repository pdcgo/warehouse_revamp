package warehouse_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// The warehouse every test configures, and its name for a refusal.
const gudangA uint64 = 11

// fakeNames names warehouses from a fixed map.
type fakeNames map[uint64]string

func (f fakeNames) WarehouseName(_ context.Context, id uint64) (string, error) {
	return f[id], nil
}

func newService(t *testing.T, db *gorm.DB) *warehouse_v1.Service {
	t.Helper()

	return warehouse_v1.NewService(db, fakeNames{gudangA: "Gudang A"})
}

// setFee saves a warehouse's fee; a cap of 0 means "leave it empty".
func setFee(t *testing.T, svc *warehouse_v1.Service, warehouseID uint64, percent, floor, cap float64) *warehousev1.WarehouseFee {
	t.Helper()

	req := &warehousev1.WarehouseFeeSetRequest{TeamId: warehouseID, FeePercent: percent, MinFee: floor}
	if cap > 0 {
		req.MaxFee = proto.Float64(cap)
	}

	res, err := svc.WarehouseFeeSet(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("WarehouseFeeSet(%d): %v", warehouseID, err)
	}

	return res.Msg.GetFee()
}
