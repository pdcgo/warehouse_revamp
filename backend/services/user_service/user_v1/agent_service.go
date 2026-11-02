package user_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// AgentService implements [userv1connect.AgentServiceHandler] — the AI agents a person connects to read a team's data
// through the MCP (docs/business/mcp/context_decision.md). It owns `agent_credentials`, `agent_oauth_*` and
// `team_agent_policies`; the OAuth endpoints an agent itself speaks are agent_oauth's.
type AgentService struct {
	db       *gorm.DB
	store    *agent_credentials.Store
	resolver access_interceptors.RoleResolver
	now      func() time.Time
}

var _ userv1connect.AgentServiceHandler = (*AgentService)(nil)

func NewAgentService(
	db *gorm.DB,
	store *agent_credentials.Store,
	resolver access_interceptors.RoleResolver,
) *AgentService {
	return &AgentService{db: db, store: store, resolver: resolver, now: time.Now}
}

var (
	errConnectionMissing = errors.New("no such connection")
	errNotAMember        = errors.New("you are not a member of this team")
	errEveryTeamIsRoots  = errors.New("only root and the administrator connect an agent to every team")
	errMembersMayNot     = errors.New("this team's owner has not allowed CS and staff to connect an agent")
)

// liveConnections is every credential still reading — not revoked, not expired — newest first.
func (s *AgentService) liveConnections(ctx context.Context) *gorm.DB {
	return s.db.WithContext(ctx).
		Model(&user_service_models.AgentCredential{}).
		Where("revoked_at IS NULL AND expires_at > ?", s.now())
}

// connectionPage reads one page of `query` and builds the guideline list envelope.
func (s *AgentService) connectionPage(
	query *gorm.DB,
	page *commonv1.CommonPagination,
	types []userv1.AgentConnectionListDataType,
) ([]*userv1.AgentConnectionListResponseItem, []uint64, *commonv1.PageInfo, error) {
	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, nil, nil, err
	}

	var rows []user_service_models.AgentCredential

	err = query.
		Order("id DESC").
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, nil, nil, err
	}

	items, ids := connectionListItems(rows, types)

	return items, ids, pageInfoOf(page, total), nil
}

// connectionListItems wraps the rows in the slices asked for — the CONNECTION slice when none is named.
func connectionListItems(
	rows []user_service_models.AgentCredential,
	types []userv1.AgentConnectionListDataType,
) ([]*userv1.AgentConnectionListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []userv1.AgentConnectionListDataType{userv1.AgentConnectionListDataType_AGENT_CONNECTION_LIST_DATA_TYPE_CONNECTION}
	}

	ids := make([]uint64, 0, len(rows))
	general := map[uint64]*commonv1.GeneralItem{}
	connections := map[uint64]*userv1.AgentConnection{}

	for i := range rows {
		row := &rows[i]
		ids = append(ids, row.ID)
		general[row.ID] = &commonv1.GeneralItem{Id: row.ID, Name: row.Name}
		connections[row.ID] = connectionToProto(row)
	}

	items := make([]*userv1.AgentConnectionListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case userv1.AgentConnectionListDataType_AGENT_CONNECTION_LIST_DATA_TYPE_GENERAL:
			items = append(items, &userv1.AgentConnectionListResponseItem{
				D: &userv1.AgentConnectionListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: general}},
			})
		case userv1.AgentConnectionListDataType_AGENT_CONNECTION_LIST_DATA_TYPE_CONNECTION:
			items = append(items, &userv1.AgentConnectionListResponseItem{
				D: &userv1.AgentConnectionListResponseItem_Connection{Connection: &userv1.AgentConnectionMapItem{MapData: connections}},
			})
		}
	}

	return items, ids
}

func connectionToProto(c *user_service_models.AgentCredential) *userv1.AgentConnection {
	out := &userv1.AgentConnection{
		Id:            c.ID,
		UserId:        c.UserID,
		TeamId:        c.TeamID,
		Name:          c.Name,
		ClientName:    c.ClientName,
		CreatedAtUnix: c.CreatedAt.Unix(),
		ExpiresAtUnix: c.ExpiresAt.Unix(),
	}

	if c.LastUsedAt != nil {
		out.LastUsedAtUnix = c.LastUsedAt.Unix()
	}

	return out
}

// revoke stamps `revoked_at` on the live connection `scope` narrows to — NotFound when there is none, so a revoke of
// somebody else's id reads the same as one that never existed.
func (s *AgentService) revoke(ctx context.Context, scope *gorm.DB) error {
	result := scope.Update("revoked_at", s.now())
	if result.Error != nil {
		return connect.NewError(connect.CodeInternal, result.Error)
	}

	if result.RowsAffected == 0 {
		return connect.NewError(connect.CodeNotFound, errConnectionMissing)
	}

	return nil
}

// callerID is the person making the call, as the interceptor put them in ctx.
func callerID(ctx context.Context) (uint64, error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0, connect.NewError(connect.CodeUnauthenticated, err)
	}

	return identity.GetIdentityId(), nil
}

// mayConnect is the-owner-decides-who-connects-an-agent: the owner and admin always, CS and staff once the owner allows
// it, root and the root team's administrator any team — or every team (0), which only they may.
func (s *AgentService) mayConnect(ctx context.Context, userID, teamID uint64) error {
	scope := teamID
	if scope == 0 {
		scope = san_auth.RootTeamID
	}

	access, err := s.resolver.Resolve(ctx, userID, scope)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	root := access.RootRole == role_basev1.Role_ROLE_ROOT || access.RootRole == role_basev1.Role_ROLE_ADMINISTRATOR

	if teamID == 0 {
		if !root {
			return connect.NewError(connect.CodePermissionDenied, errEveryTeamIsRoots)
		}

		return nil
	}

	switch access.Role {
	case role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR:
		return nil
	case role_basev1.Role_ROLE_UNSPECIFIED:
		if root {
			return nil
		}

		return connect.NewError(connect.CodePermissionDenied, errNotAMember)
	}

	allowed, err := s.membersMayConnect(ctx, teamID)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	if !allowed {
		return connect.NewError(connect.CodePermissionDenied, errMembersMayNot)
	}

	return nil
}

// membersMayConnect reads the team's switch — no row reads as off.
func (s *AgentService) membersMayConnect(ctx context.Context, teamID uint64) (bool, error) {
	var rows []user_service_models.TeamAgentPolicy

	err := s.db.WithContext(ctx).
		Where("team_id = ?", teamID).
		Limit(1).
		Find(&rows).
		Error
	if err != nil {
		return false, err
	}

	return len(rows) == 1 && rows[0].MembersMayConnect, nil
}

func pageInfoOf(page *commonv1.CommonPagination, total int64) *commonv1.PageInfo {
	limit := uint64(page.GetLimit())

	var pages uint64
	if limit > 0 {
		pages = (uint64(total) + limit - 1) / limit
	}

	return &commonv1.PageInfo{
		CurrentPage: page.GetPage(),
		TotalPage:   uint32(pages),
		TotalItems:  uint64(total),
	}
}
