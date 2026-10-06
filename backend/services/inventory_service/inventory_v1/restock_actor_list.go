package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockActorList implements [inventoryv1connect.RestockRequestServiceHandler].
//
// The people a restock list's "who" filter offers (a-who-filter-lists-the-people-on-its-rows): everyone who
// raised — or accepted — a restock this team may list, the latest act first. The same two sides as
// RestockRequestList, so the filter can never offer a person the list cannot show, nor miss one it does.
//
// A person who has left the team, or whose account is suspended, is still here: they are on the rows
// (a-filter-keeps-former-and-suspended-people). 0 is "not recorded", never a person.
func (s *Service) RestockActorList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockActorListRequest],
) (*connect.Response[inventoryv1.RestockActorListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()
	userCol, atCol := restockActorColumns(req.Msg.GetFilter().GetRole())

	// A fresh query per statement: the count and the page must not share one GORM statement.
	scope := func() *gorm.DB {
		return s.db.
			WithContext(ctx).
			Table("restock_requests").
			Where("(requesting_team_id = ? OR warehouse_id = ?)", teamID, teamID).
			Where(userCol + " <> 0")
	}

	var total int64

	err := scope().
		Select("COUNT(DISTINCT " + userCol + ")").
		Scan(&total).
		Error
	if err != nil {
		return nil, restockErr(err)
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
		Select(userCol + " AS user_id, MAX(" + atCol + ") AS last_at").
		Group(userCol).
		// user_id breaks a tie, so a page boundary never splits two people done in the same second.
		Order("last_at " + order + ", user_id " + order).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	actors := make(map[uint64]*inventoryv1.RestockActorItem, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, row := range rows {
		actors[row.UserID] = &inventoryv1.RestockActorItem{UserId: row.UserID, LastAtUnix: row.LastAt.Unix()}
		ids = append(ids, row.UserID)
	}

	return connect.NewResponse(&inventoryv1.RestockActorListResponse{
		// ACTOR is the only slice there is, so it is sent whatever data_request says.
		Items: []*inventoryv1.RestockActorListResponseItem{{
			D: &inventoryv1.RestockActorListResponseItem_Actor{Actor: &inventoryv1.RestockActorMapItem{MapData: actors}},
		}},
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// restockActorColumns maps the act to its person and its moment.
//
// A CLOSED switch over the enum, never a caller-supplied string: both are concatenated into SQL above.
// An accept older than its timestamp column reads by when the restock was raised rather than vanishing.
func restockActorColumns(role inventoryv1.RestockActorRole) (string, string) {
	if role == inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_ACCEPTED {
		return "accepted_by_user_id", "COALESCE(accepted_at, created_at)"
	}

	return "created_by_user_id", "created_at"
}
