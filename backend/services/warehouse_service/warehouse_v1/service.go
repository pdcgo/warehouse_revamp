package warehouse_v1

import (
	"context"
	"math"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1/warehousev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// WarehouseNamer names a warehouse for a refusal ("Gudang A has not set its fee"). A team is team_service's, so this is
// an interface this service owns, adapted at the composition root.
type WarehouseNamer interface {
	WarehouseName(ctx context.Context, warehouseID uint64) (string, error)
}

// Service is warehouse_service (warehouse-prices-balance-records): the fee configuration and its calculation. It never
// posts, never records, and never knows an order exists.
type Service struct {
	db    *gorm.DB
	names WarehouseNamer
}

var _ warehousev1connect.WarehouseFeeServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB, names WarehouseNamer) *Service {
	return &Service{db: db, names: names}
}

// feeToProto maps a row; an absent cap stays absent.
func feeToProto(row *warehouse_service_models.WarehouseFee) *warehousev1.WarehouseFee {
	return &warehousev1.WarehouseFee{
		WarehouseId:   row.WarehouseID,
		FeePercent:    row.FeePercent,
		MinFee:        row.MinFee,
		MaxFee:        row.MaxFee,
		UpdatedAtUnix: row.UpdatedAt.Unix(),
	}
}

// fee is the decided formula: clamp(goods_cost × fee_percent / 100, min_fee, max_fee), the cap only when one is set
// (the-fee-has-a-floor-and-a-cap, an-empty-cap-means-no-cap). Unrounded: when a frozen figure is rounded is not decided
// (rupiah-is-floating-point).
func fee(row *warehouse_service_models.WarehouseFee, goodsCost float64) float64 {
	amount := math.Max(goodsCost*row.FeePercent/100, row.MinFee)

	if row.MaxFee != nil {
		amount = math.Min(amount, *row.MaxFee)
	}

	return amount
}

func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}
