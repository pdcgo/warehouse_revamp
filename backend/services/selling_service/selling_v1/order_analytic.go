package selling_v1

import (
	"context"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
)

// TeamTypeReader answers whether a team is a WAREHOUSE — what decides an order metric's reader
// (a-warehouse-reads-the-orders-it-ships): a warehouse reads the orders it ships and none of their money
// (a-warehouse-sees-no-seller-money). An interface this service owns, so selling_service never imports team_service;
// the composition root adapts TeamByIds to it.
type TeamTypeReader interface {
	IsWarehouse(ctx context.Context, teamID uint64) (bool, error)
}

// Analytic serves the ORDER METRICS (docs/business/order/order_statistic_metric.md): OrderAnalyticService's two reads,
// and the fold that builds the report they read.
//
// Its own struct rather than more methods on Service: it needs one dependency nothing else in this service does (the
// team type), and its tables are derived — nothing on an order's write path touches it.
type Analytic struct {
	db    *gorm.DB
	teams TeamTypeReader
}

var _ sellingv1connect.OrderAnalyticServiceHandler = (*Analytic)(nil)

func NewAnalytic(db *gorm.DB, teams TeamTypeReader) *Analytic {
	return &Analytic{db: db, teams: teams}
}
