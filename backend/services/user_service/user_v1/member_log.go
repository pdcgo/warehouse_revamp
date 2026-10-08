package user_v1

import (
	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// logMembership writes one row of the membership log (every-role-change-is-logged) — inside tx, the SAME
// transaction as the change it records, so a membership never changes without its row and a rolled-back change
// leaves none.
//
// `before` and `after` are the person's role in the team on either side (UNSPECIFIED = not a member). Nothing
// changing writes nothing: an add that repeats the role a person already holds — a retried grant — is not a
// change, and the log is a record of changes.
//
// It returns the row it wrote — nil when nothing changed — so a removal can announce it after the commit.
func logMembership(
	tx *gorm.DB,
	caller callerReach,
	teamID, userID uint64,
	before, after role_basev1.Role,
) (*user_service_models.TeamMemberLog, error) {
	if before == after {
		return nil, nil
	}

	action := userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_CHANGE_ROLE

	switch {
	case before == role_basev1.Role_ROLE_UNSPECIFIED:
		action = userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_ADD
	case after == role_basev1.Role_ROLE_UNSPECIFIED:
		action = userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_REMOVE
	}

	row := user_service_models.TeamMemberLog{
		TeamID:     teamID,
		UserID:     userID,
		Action:     int16(action),
		RoleBefore: int32(before),
		RoleAfter:  int32(after),
		IsOverride: caller.isOverride(),
	}

	// A developer through tools/san is recorded as such, with no user (the table's CHECK wants one or the other).
	if caller.agent != "" {
		row.ActorAgent = caller.agent
	} else {
		actor := caller.id
		row.ActorUserID = &actor
	}

	err := tx.Create(&row).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return &row, nil
}

// isOverride: Root or the Administrator acting in a team they hold no role in — through the root-team bypass,
// not a membership (an-override-is-stamped-in-every-service). A Root who IS a member of the team acts as that member.
func (c callerReach) isOverride() bool {
	return c.agent == "" && (c.isRoot() || c.isAdministrator()) && c.inTeam == role_basev1.Role_ROLE_UNSPECIFIED
}
