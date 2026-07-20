// Package revenue_v1 implements warehouse.revenue.v1.RevenueService — what each order was EXPECTED to
// make, frozen when it was placed (#75).
//
// The expected figure is stored rather than computed on read, so #76 has something to reconcile an
// actual payout against. Every RPC is scoped by the SELLING team (use_scope); order_id is an opaque
// selling_service id.
package revenue_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1/revenuev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ revenuev1connect.RevenueServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// Recording an order twice would DOUBLE every total computed from this table — the kind of error that
// looks like good news, which is why it is refused rather than tolerated.
var errAlreadyRecorded = errors.New("this order's revenue has already been recorded")

func revenueErr(err error) error {
	if errors.Is(err, errAlreadyRecorded) || errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists, errAlreadyRecorded)
	}

	return connect.NewError(connect.CodeInternal, err)
}

func orderRevenueToProto(r *revenue_service_models.OrderRevenue) *revenuev1.OrderRevenue {
	return &revenuev1.OrderRevenue{
		Id:             r.ID,
		TeamId:         r.TeamID,
		OrderId:        r.OrderID,
		Revenue:        r.Revenue,
		Cogs:           r.COGS,
		ShippingCost:   r.ShippingCost,
		ExpectedMargin: r.ExpectedMargin,
		CostKnown:      r.CostKnown,
		CreatedAtUnix:  r.CreatedAt.Unix(),
	}
}
