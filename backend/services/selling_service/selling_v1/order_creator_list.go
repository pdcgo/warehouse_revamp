package selling_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderCreatorList implements [sellingv1connect.OrderServiceHandler].
//
// The people the order list's "created by" filter offers (a-who-filter-lists-the-people-on-its-rows):
// everyone who typed in an order this team may list, the latest first. It reads the same set OrderList does
// — scopedOrders with no filter — so the picker can never offer a person the list cannot show.
//
// A person who has left the team, or whose account is suspended, is still here: they are on the rows
// (a-filter-keeps-former-and-suspended-people). 0 is "not recorded", never a person.
func (s *Service) OrderCreatorList(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCreatorListRequest],
) (*connect.Response[sellingv1.OrderCreatorListResponse], error) {
	page := req.Msg.GetPage()

	// A fresh query per statement: the count and the page must not share one GORM statement.
	scope := func() *gorm.DB {
		query := scopedOrders(
			s.db.WithContext(ctx).Model(&selling_service_models.Order{}),
			req.Msg.GetTeamId(),
			&sellingv1.OrderListFilter{},
		)

		return query.Where("created_by_user_id <> 0")
	}

	var total int64

	err := scope().
		Select("COUNT(DISTINCT created_by_user_id)").
		Scan(&total).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	order := "DESC"
	if req.Msg.GetSort().GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
		order = "ASC"
	}

	var rows []struct {
		UserID uint64
		LastAt time.Time
	}

	err = scope().
		Select("created_by_user_id AS user_id, MAX(created_at) AS last_at").
		Group("created_by_user_id").
		// user_id breaks a tie, so a page boundary never splits two people who typed in the same second.
		Order("last_at " + order + ", user_id " + order).
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	creators := make(map[uint64]*sellingv1.OrderCreatorItem, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, row := range rows {
		creators[row.UserID] = &sellingv1.OrderCreatorItem{UserId: row.UserID, LastAtUnix: row.LastAt.Unix()}
		ids = append(ids, row.UserID)
	}

	return connect.NewResponse(&sellingv1.OrderCreatorListResponse{
		// CREATOR is the only slice there is, so it is sent whatever data_request says.
		Items: []*sellingv1.OrderCreatorListResponseItem{{
			D: &sellingv1.OrderCreatorListResponseItem_Creator{Creator: &sellingv1.OrderCreatorMapItem{MapData: creators}},
		}},
		Ids: ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
