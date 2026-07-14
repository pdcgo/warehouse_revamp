// Package product_v1 implements warehouse.product.v1.ProductService — a team's product catalogue.
//
// Every RPC is team-scoped: the request carries team_id (use_scope), and each query is constrained
// to that team, so a caller can never read or mutate another team's product by id.
package product_v1

import (
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1/productv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ productv1connect.ProductServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

var errProductMissing = errors.New("product not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errProductMissing)
}

// dbError maps a duplicate SKU to AlreadyExists (a client error) and everything else to Internal.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a product with this SKU already exists in the team"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// productExists reports whether an ACTIVE product with this id exists IN THIS TEAM. The team_id
// clause is the scope check — it is what stops one team touching another's product by id.
func productExists(tx *gorm.DB, teamID, productID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&product_service_models.Product{}).
		Where("id = ? AND team_id = ? AND deleted = ?", productID, teamID, false).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}
