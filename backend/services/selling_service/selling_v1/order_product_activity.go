package selling_v1

import (
	"context"
	"database/sql"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// The rolling window the "recent" figures use. Thirty days is what a person means by "lately" for a
// catalogue: long enough that a slow seller still registers, short enough that last quarter's hit
// product does not read as this month's.
const activityWindow = 30 * 24 * time.Hour

// OrderProductActivityByIds answers, for a set of the caller's products, when each last sold and how
// many units moved in the last 30 days.
//
// CANCELLED orders are excluded from both. A cancelled order is not a sale — counting one would make
// a product that has never actually moved look like it is selling, which is precisely the mistake
// this column exists to prevent somebody making.
func (s *Service) OrderProductActivityByIds(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderProductActivityByIdsRequest],
) (*connect.Response[sellingv1.OrderProductActivityByIdsResponse], error) {
	teamID := req.Msg.GetTeamId()
	productIDs := req.Msg.GetFilter().GetProductIds()

	type scan struct {
		ProductID uint64
		LastUnix  int64
		Sold30D   int64
	}

	var rows []scan

	// One GROUP BY over the order lines, with the 30-day sum as a FILTER on the same pass — the
	// window is a subset of the rows already being read, so a second query would be the same scan
	// twice.
	err := s.db.
		WithContext(ctx).
		Table("order_items AS i").
		Select(`i.product_id AS product_id,
		        EXTRACT(EPOCH FROM MAX(o.created_at))::bigint AS last_unix,
		        COALESCE(SUM(i.quantity) FILTER (WHERE o.created_at >= ?), 0) AS sold30_d`,
			time.Now().Add(-activityWindow)).
		Joins("JOIN orders o ON o.id = i.order_id").
		Where("o.team_id = ?", teamID).
		Where("o.status <> ?", orderStatusCancelled).
		Where("i.product_id IN ?", productIDs).
		Group("i.product_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []sellingv1.OrderProductActivityDataType{
			sellingv1.OrderProductActivityDataType_ORDER_PRODUCT_ACTIVITY_DATA_TYPE_ACTIVITY,
		}
	}

	out := make(map[uint64]*sellingv1.OrderProductActivityByIdsResponseList, len(rows))

	for _, row := range rows {
		item := &sellingv1.OrderProductActivityItem{
			LastOrderUnix: row.LastUnix,
			SoldQty_30D:   row.Sold30D,
		}

		slices := make([]*sellingv1.OrderProductActivityByIdsResponseItem, 0, len(types))

		for _, t := range types {
			if t != sellingv1.OrderProductActivityDataType_ORDER_PRODUCT_ACTIVITY_DATA_TYPE_ACTIVITY {
				continue
			}

			slices = append(slices, &sellingv1.OrderProductActivityByIdsResponseItem{
				D: &sellingv1.OrderProductActivityByIdsResponseItem_Activity{
					Activity: &sellingv1.OrderProductActivityMapItem{
						MapData: map[uint64]*sellingv1.OrderProductActivityItem{row.ProductID: item},
					},
				},
			})
		}

		out[row.ProductID] = &sellingv1.OrderProductActivityByIdsResponseList{Items: slices}
	}

	return connect.NewResponse(&sellingv1.OrderProductActivityByIdsResponse{Items: out}), nil
}

// OrderActivityStat is the same question asked of the whole team rather than of listed products — the
// "Last order" tile above the product list.
//
// Its own read rather than a max over the page, for the same reason the stock stat is: a headline that
// changed when somebody typed in the search box would be describing the search, not the business.
func (s *Service) OrderActivityStat(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderActivityStatRequest],
) (*connect.Response[sellingv1.OrderActivityStatResponse], error) {
	teamID := req.Msg.GetTeamId()

	var row struct {
		// MAX over no rows is NULL — a team that has never sold anything needs a nullable target.
		LastAt   sql.NullTime
		Orders30 int64
	}

	err := s.db.
		WithContext(ctx).
		Table("orders").
		Select(`MAX(created_at) AS last_at,
		        COUNT(*) FILTER (WHERE created_at >= ?) AS orders30`,
			time.Now().Add(-activityWindow)).
		Where("team_id = ?", teamID).
		Where("status <> ?", orderStatusCancelled).
		Scan(&row).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	preview := &sellingv1.OrderActivityPreview{Orders_30D: row.Orders30}
	if row.LastAt.Valid {
		preview.LastOrderUnix = row.LastAt.Time.Unix()
	}

	return connect.NewResponse(&sellingv1.OrderActivityStatResponse{Preview: preview}), nil
}
