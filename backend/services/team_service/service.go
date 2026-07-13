package team_service

import (
	"errors"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// Service implements [teamv1connect.TeamServiceHandler].
//
// It owns `teams` and `team_infos` and NOTHING else. It never reads user_service's tables — the
// owner grant in TeamCreate goes over RPC, and role checks go through san_auth's RPC resolver.
type Service struct {
	db *gorm.DB

	// userClient grants the team owner at create time. It is a real RPC even though both
	// services currently share a binary: the boundary is the point.
	userClient userv1connect.UserServiceClient
}

var _ teamv1connect.TeamServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB, userClient userv1connect.UserServiceClient) *Service {
	return &Service{db: db, userClient: userClient}
}

// rootTeamID mirrors san_auth.RootTeamID. Deleting it would strand every super-admin bypass in
// the system.
const rootTeamID = san_auth.RootTeamID

// isUniqueViolation detects a duplicate key.
//
// It must check BOTH forms. We open GORM with TranslateError:true, so GORM has usually already
// converted the driver error into gorm.ErrDuplicatedKey — checking only for the raw Postgres
// SQLSTATE 23505 silently misses every translated one, and the client gets an opaque Internal
// instead of AlreadyExists. (That is exactly what happened the first time this ran.)
func isUniqueViolation(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var pgErr *pgconn.PgError

	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}

	return false
}

func dbError(err error) error {
	if isUniqueViolation(err) {
		return connect.NewError(connect.CodeAlreadyExists, errors.New("team_code already exists"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errors.New("team not found"))
}
