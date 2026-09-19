package user_v1_test

import (
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// Test helpers that read the guideline list/by-ids shapes back into flat slices/maps. The handlers
// default an empty data_request to the row slice (USER / PUBLIC_USER / TEAM_ACCESS), so tests that
// don't set one get it here.

func userRows(res *userv1.UserListResponse) []*userv1.User {
	var rowMap map[uint64]*userv1.User
	for _, it := range res.GetItems() {
		u := it.GetUser()
		if u != nil {
			rowMap = u.GetMapData()
		}
	}

	out := make([]*userv1.User, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := rowMap[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func publicUsersByIds(res *userv1.UserByIDsResponse) map[uint64]*userv1.PublicUser {
	out := map[uint64]*userv1.PublicUser{}
	for id, list := range res.GetItems() {
		for _, it := range list.GetItems() {
			pu := it.GetPublicUser()
			if pu == nil {
				continue
			}

			r, ok := pu.GetMapData()[id]
			if ok {
				out[id] = r
			}
		}
	}

	return out
}

// teamAccessRows flattens a membership-list response (shared by TeamAccessList and UserTeams) to the
// TEAM_ACCESS slice, in the response's sorted id order.
func teamAccessRows(items []*userv1.TeamAccessListResponseItem, ids []uint64) []*userv1.TeamAccessItem {
	var rowMap map[uint64]*userv1.TeamAccessItem
	for _, it := range items {
		ta := it.GetTeamAccess()
		if ta != nil {
			rowMap = ta.GetMapData()
		}
	}

	out := make([]*userv1.TeamAccessItem, 0, len(ids))
	for _, id := range ids {
		r, ok := rowMap[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}
