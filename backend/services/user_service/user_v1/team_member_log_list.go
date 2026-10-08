package user_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// TeamMemberLogList implements [userv1connect.UserServiceHandler].
//
// One team's membership history (every-role-change-is-logged): every add, role change and removal, newest first
// unless asked otherwise, optionally one person's. The interceptor has proved the caller manages this team's
// members; the rows are written by TeamUserUpdate and CreateUser in the transaction of the change itself.
func (s *Service) TeamMemberLogList(
	ctx context.Context,
	req *connect.Request[userv1.TeamMemberLogListRequest],
) (*connect.Response[userv1.TeamMemberLogListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&user_service_models.TeamMemberLog{}).
		Where("team_id = ?", req.Msg.GetTeamId())

	if userID := req.Msg.GetFilter().GetUserId(); userID > 0 {
		query = query.Where("user_id = ?", userID)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var rows []user_service_models.TeamMemberLog

	// id order IS insert order, and the indexes are on (team_id[, user_id], id DESC).
	order := "id DESC"
	if req.Msg.GetSort().GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
		order = "id ASC"
	}

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order(order).
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	entries := make(map[uint64]*userv1.TeamMemberLogEntry, len(rows))
	ids := make([]uint64, 0, len(rows))

	for i := range rows {
		entries[rows[i].ID] = memberLogToProto(&rows[i])
		ids = append(ids, rows[i].ID)
	}

	return connect.NewResponse(&userv1.TeamMemberLogListResponse{
		// ENTRY is the only slice there is, so it is sent whatever data_request says.
		Items: []*userv1.TeamMemberLogListResponseItem{{
			D: &userv1.TeamMemberLogListResponseItem_Entry{Entry: &userv1.TeamMemberLogMapItem{MapData: entries}},
		}},
		Ids: ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

func memberLogToProto(row *user_service_models.TeamMemberLog) *userv1.TeamMemberLogEntry {
	var actor uint64
	if row.ActorUserID != nil {
		actor = *row.ActorUserID
	}

	return &userv1.TeamMemberLogEntry{
		Id:            row.ID,
		TeamId:        row.TeamID,
		ActorUserId:   actor,
		ActorAgent:    row.ActorAgent,
		UserId:        row.UserID,
		Action:        userv1.TeamMemberLogAction(row.Action),
		RoleBefore:    role_basev1.Role(row.RoleBefore),
		RoleAfter:     role_basev1.Role(row.RoleAfter),
		IsOverride:    row.IsOverride,
		CreatedAtUnix: row.CreatedAt.Unix(),
	}
}
