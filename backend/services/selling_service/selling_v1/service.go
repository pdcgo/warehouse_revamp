// Package selling_v1 implements warehouse.selling.v1.ShopService — a selling team's marketplace
// shops (#66). selling_service will grow to own orders too (the #23 decomposition).
//
// Every RPC is team-scoped: the request carries team_id (use_scope), and each query is constrained
// to that team, so a caller can never read or mutate another team's shop by id.
package selling_v1

import (
	"errors"
	"math"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ sellingv1connect.ShopServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

var errShopMissing = errors.New("shop not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errShopMissing)
}

// dbError maps a duplicate shop code to AlreadyExists (a client error) and everything else to
// Internal.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a shop with this code already exists in the team"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// shopExists reports whether an ACTIVE shop with this id exists IN THIS TEAM. The team_id clause is
// the scope check — it is what stops one team touching another's shop by id.
func shopExists(tx *gorm.DB, teamID, shopID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&selling_service_models.Shop{}).
		Where("id = ? AND team_id = ? AND deleted = ?", shopID, teamID, false).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}

// escapeLike neutralises LIKE wildcards so a search for "%" doesn't match everything.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
