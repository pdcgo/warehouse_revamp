package team_service

import (
	"fmt"

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
	}
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

	return out
}
