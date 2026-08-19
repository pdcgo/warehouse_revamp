package team_v1

import (
	"fmt"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// The enum<->text mapping lives HERE and nowhere else.
//
// The database stores `type` as TEXT (readable in psql, validated by a CHECK); the wire uses
// the enum. Every conversion goes through these two functions, so the two representations
// cannot drift.

const (
	typeRoot      = "root"
	typeAdmin     = "admin"
	typeWarehouse = "warehouse"
	typeSelling   = "selling"
)

func teamTypeToText(t teamv1.TeamType) (string, error) {
	switch t {
	case teamv1.TeamType_TEAM_TYPE_ROOT:
		return typeRoot, nil
	case teamv1.TeamType_TEAM_TYPE_ADMIN:
		return typeAdmin, nil
	case teamv1.TeamType_TEAM_TYPE_WAREHOUSE:
		return typeWarehouse, nil
	case teamv1.TeamType_TEAM_TYPE_SELLING:
		return typeSelling, nil
	default:
		return "", fmt.Errorf("unknown team type %v", t)
	}
}

// teamTypeFromText never invents a value: an unrecognised string is UNSPECIFIED, not a guess.
// The CHECK constraint means it should be unreachable.
func teamTypeFromText(text string) teamv1.TeamType {
	switch text {
	case typeRoot:
		return teamv1.TeamType_TEAM_TYPE_ROOT
	case typeAdmin:
		return teamv1.TeamType_TEAM_TYPE_ADMIN
	case typeWarehouse:
		return teamv1.TeamType_TEAM_TYPE_WAREHOUSE
	case typeSelling:
		return teamv1.TeamType_TEAM_TYPE_SELLING
	default:
		return teamv1.TeamType_TEAM_TYPE_UNSPECIFIED
	}
}

// ownerRoleFor returns the OWNER role appropriate to a team's type. A warehouse team's owner is
// ROLE_WAREHOUSE_OWNER; everything else is ROLE_TEAM_OWNER. They are the same role in different
// team types.
func ownerRoleFor(t teamv1.TeamType) int32 {
	const (
		roleTeamOwner      = 3 // role_base.v1.ROLE_TEAM_OWNER
		roleWarehouseOwner = 6 // role_base.v1.ROLE_WAREHOUSE_OWNER
	)

	if t == teamv1.TeamType_TEAM_TYPE_WAREHOUSE {
		return roleWarehouseOwner
	}

	return roleTeamOwner
}

func teamToProto(team *team_service_models.Team) *teamv1.Team {
	return &teamv1.Team{
		Id:          team.ID,
		Type:        teamTypeFromText(team.Type),
		Name:        team.Name,
		TeamCode:    team.TeamCode,
		Description: team.Description,
		Deleted:     team.Deleted,
		ImageUrl:    team.ImageURL,

		PriorityProduct: team.PriorityProduct,
	}
}

// ── Guideline list/by-ids slices (guidelines/service-guideline.md) ────────────────────────────────

// teamRowItem is the TEAM (row) slice — the fields a list/picker renders (mirrors Team minus `info`).
func teamRowItem(t *team_service_models.Team) *teamv1.TeamRowItem {
	return &teamv1.TeamRowItem{
		Id:          t.ID,
		Type:        teamTypeFromText(t.Type),
		Name:        t.Name,
		TeamCode:    t.TeamCode,
		Description: t.Description,
		Deleted:     t.Deleted,
		ImageUrl:    t.ImageURL,

		// Carried on the row so a picker that lists priority teams can read the flag off the same
		// response it already paged, rather than a second per-team lookup.
		PriorityProduct: t.PriorityProduct,
	}
}

// teamOrderClause maps a ListFilterSort to a safe "column DIR" ORDER BY (fixed whitelist). Default is
// newest-first (id DESC), the legacy behaviour.
func teamOrderClause(sort *teamv1.TeamListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *teamv1.TeamListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *teamv1.TeamListFilterSort_Team:
			switch s.Team {
			case teamv1.TeamRowSort_TEAM_ROW_SORT_NAME:
				col = "name"
			case teamv1.TeamRowSort_TEAM_ROW_SORT_TEAM_CODE:
				col = "team_code"
			case teamv1.TeamRowSort_TEAM_ROW_SORT_ID:
				col = "id"
			}
		}
	}

	return col + " " + dir
}

func teamGeneralMap(teams []team_service_models.Team) *commonv1.GeneralMapItem {
	m := make(map[uint64]*commonv1.GeneralItem, len(teams))
	for i := range teams {
		m[teams[i].ID] = &commonv1.GeneralItem{Id: teams[i].ID, Name: teams[i].Name}
	}

	return &commonv1.GeneralMapItem{MapData: m}
}

func teamRowMap(teams []team_service_models.Team) *teamv1.TeamRowMapItem {
	m := make(map[uint64]*teamv1.TeamRowItem, len(teams))
	for i := range teams {
		m[teams[i].ID] = teamRowItem(&teams[i])
	}

	return &teamv1.TeamRowMapItem{MapData: m}
}

// teamListItems builds the response slices for the requested data types (defaulting to the TEAM row
// slice) plus the sorted id list, from teams already in display order.
func teamListItems(
	teams []team_service_models.Team,
	types []teamv1.TeamListDataType,
) ([]*teamv1.TeamListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []teamv1.TeamListDataType{teamv1.TeamListDataType_TEAM_LIST_DATA_TYPE_TEAM}
	}

	ids := make([]uint64, 0, len(teams))
	for i := range teams {
		ids = append(ids, teams[i].ID)
	}

	items := make([]*teamv1.TeamListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case teamv1.TeamListDataType_TEAM_LIST_DATA_TYPE_GENERAL:
			items = append(items, &teamv1.TeamListResponseItem{
				D: &teamv1.TeamListResponseItem_General{General: teamGeneralMap(teams)},
			})
		case teamv1.TeamListDataType_TEAM_LIST_DATA_TYPE_TEAM:
			items = append(items, &teamv1.TeamListResponseItem{
				D: &teamv1.TeamListResponseItem_Team{Team: teamRowMap(teams)},
			})
		}
	}

	return items, ids
}

// teamByIdsMap builds the by-ids response: a map keyed by team id, each value holding the requested
// slices for that one team (defaulting to the TEAM row slice).
func teamByIdsMap(
	teams []team_service_models.Team,
	types []teamv1.TeamByIdsDataType,
) map[uint64]*teamv1.TeamByIdsResponseList {
	if len(types) == 0 {
		types = []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM}
	}

	out := make(map[uint64]*teamv1.TeamByIdsResponseList, len(teams))
	for i := range teams {
		one := teams[i : i+1]

		slices := make([]*teamv1.TeamByIdsResponseItem, 0, len(types))
		for _, t := range types {
			switch t {
			case teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &teamv1.TeamByIdsResponseItem{
					D: &teamv1.TeamByIdsResponseItem_General{General: teamGeneralMap(one)},
				})
			case teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM:
				slices = append(slices, &teamv1.TeamByIdsResponseItem{
					D: &teamv1.TeamByIdsResponseItem_Team{Team: teamRowMap(one)},
				})
			}
		}

		out[teams[i].ID] = &teamv1.TeamByIdsResponseList{Items: slices}
	}

	return out
}

func teamInfoToProto(info *team_service_models.TeamInfo) *teamv1.TeamInfo {
	out := &teamv1.TeamInfo{
		TeamId:            info.TeamID,
		ContactNumber:     info.ContactNumber,
		BankType:          info.BankType,
		BankOwnerName:     info.BankOwnerName,
		BankAccountNumber: info.BankAccountNumber,
	}

	if info.ReturnWarehouseID != nil {
		out.ReturnWarehouseId = *info.ReturnWarehouseID
	}

	if info.ReturnUserID != nil {
		out.ReturnUserId = *info.ReturnUserID
	}

	// The default shipping warehouse (#145). 0 on the wire = not configured, like the ids above.
	if info.DefaultWarehouseID != nil {
		out.DefaultWarehouseId = *info.DefaultWarehouseID
	}

	return out
}
