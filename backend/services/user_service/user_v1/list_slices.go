package user_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The guideline list/by-ids slice builders (guidelines/service-guideline.md). The USER / PUBLIC_USER /
// TEAM_ACCESS slices reuse the User / PublicUser / TeamAccessItem messages directly (each already IS
// its list shape), so these only wrap them in the flexible items/ids envelope.

// userOrderClause maps a ListFilterSort to a safe "column DIR" ORDER BY (fixed whitelist, table
// qualified because UserList joins). Default is users.id ASC, the legacy behaviour.
func userOrderClause(sort *userv1.UserListFilterSort) string {
	col := "users.id"
	dir := "ASC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			dir = "DESC"
		}

		switch s := sort.GetS().(type) {
		case *userv1.UserListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "users.name"
			}
		case *userv1.UserListFilterSort_User:
			switch s.User {
			case userv1.UserRowSort_USER_ROW_SORT_NAME:
				col = "users.name"
			case userv1.UserRowSort_USER_ROW_SORT_USERNAME:
				col = "users.username"
			case userv1.UserRowSort_USER_ROW_SORT_ID:
				col = "users.id"
			}
		}
	}

	return col + " " + dir
}

// userListItems builds the response slices for the requested data types (defaulting to the USER row
// slice) plus the sorted id list, from users already in display order.
func userListItems(
	users []user_service_models.User,
	types []userv1.UserListDataType,
) ([]*userv1.UserListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []userv1.UserListDataType{userv1.UserListDataType_USER_LIST_DATA_TYPE_USER}
	}

	ids := make([]uint64, 0, len(users))
	for i := range users {
		ids = append(ids, users[i].ID)
	}

	items := make([]*userv1.UserListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case userv1.UserListDataType_USER_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(users))
			for i := range users {
				m[users[i].ID] = &commonv1.GeneralItem{Id: users[i].ID, Name: users[i].Name}
			}
			items = append(items, &userv1.UserListResponseItem{
				D: &userv1.UserListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case userv1.UserListDataType_USER_LIST_DATA_TYPE_USER:
			m := make(map[uint64]*userv1.User, len(users))
			for i := range users {
				m[users[i].ID] = userToProto(&users[i])
			}
			items = append(items, &userv1.UserListResponseItem{
				D: &userv1.UserListResponseItem_User{User: &userv1.UserRowMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// userByIdsMap builds the by-ids response: a map keyed by user id, each value holding the requested
// slices for that one user (defaulting to the PUBLIC_USER slice — no email, no phone).
func userByIdsMap(
	users []user_service_models.User,
	types []userv1.UserByIdsDataType,
) map[uint64]*userv1.UserByIDsResponseList {
	if len(types) == 0 {
		types = []userv1.UserByIdsDataType{userv1.UserByIdsDataType_USER_BY_IDS_DATA_TYPE_PUBLIC_USER}
	}

	out := make(map[uint64]*userv1.UserByIDsResponseList, len(users))
	for i := range users {
		u := &users[i]

		slices := make([]*userv1.UserByIDsResponseItem, 0, len(types))
		for _, t := range types {
			switch t {
			case userv1.UserByIdsDataType_USER_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &userv1.UserByIDsResponseItem{
					D: &userv1.UserByIDsResponseItem_General{
						General: &commonv1.GeneralMapItem{MapData: map[uint64]*commonv1.GeneralItem{
							u.ID: {Id: u.ID, Name: u.Name},
						}},
					},
				})
			case userv1.UserByIdsDataType_USER_BY_IDS_DATA_TYPE_PUBLIC_USER:
				slices = append(slices, &userv1.UserByIDsResponseItem{
					D: &userv1.UserByIDsResponseItem_PublicUser{
						PublicUser: &userv1.PublicUserMapItem{MapData: map[uint64]*userv1.PublicUser{
							u.ID: publicUserToProto(u),
						}},
					},
				})
			}
		}

		out[u.ID] = &userv1.UserByIDsResponseList{Items: slices}
	}

	return out
}

// teamAccessOrderClause maps a membership sort to a safe "column DIR" ORDER BY. Default team_id ASC.
func teamAccessOrderClause(sort *userv1.TeamAccessFilterSort) string {
	col := "team_id"
	dir := "ASC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			dir = "DESC"
		}

		if s, ok := sort.GetS().(*userv1.TeamAccessFilterSort_TeamAccess); ok {
			switch s.TeamAccess {
			case userv1.TeamAccessSort_TEAM_ACCESS_SORT_ROLE:
				col = "role"
			case userv1.TeamAccessSort_TEAM_ACCESS_SORT_TEAM_ID:
				col = "team_id"
			}
		}
	}

	return col + " " + dir
}

// teamAccessListItems wraps already-built TeamAccessItems (keyed by team_id, in display order) into
// the flexible items/ids envelope, for the requested data types (defaulting to TEAM_ACCESS).
func teamAccessListItems(
	memberships []*userv1.TeamAccessItem,
	types []userv1.TeamAccessDataType,
) ([]*userv1.TeamAccessListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []userv1.TeamAccessDataType{userv1.TeamAccessDataType_TEAM_ACCESS_DATA_TYPE_TEAM_ACCESS}
	}

	ids := make([]uint64, 0, len(memberships))
	for _, m := range memberships {
		ids = append(ids, m.GetTeamId())
	}

	items := make([]*userv1.TeamAccessListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case userv1.TeamAccessDataType_TEAM_ACCESS_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(memberships))
			for _, ta := range memberships {
				m[ta.GetTeamId()] = &commonv1.GeneralItem{Id: ta.GetTeamId(), Name: ta.GetTeamName()}
			}
			items = append(items, &userv1.TeamAccessListResponseItem{
				D: &userv1.TeamAccessListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case userv1.TeamAccessDataType_TEAM_ACCESS_DATA_TYPE_TEAM_ACCESS:
			m := make(map[uint64]*userv1.TeamAccessItem, len(memberships))
			for _, ta := range memberships {
				m[ta.GetTeamId()] = ta
			}
			items = append(items, &userv1.TeamAccessListResponseItem{
				D: &userv1.TeamAccessListResponseItem_TeamAccess{TeamAccess: &userv1.TeamAccessMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}
