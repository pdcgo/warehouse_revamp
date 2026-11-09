// Package product_v1 implements warehouse.product.v1.ProductService — a team's product catalogue — and BundleService,
// its picking recipes.
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
	db      *gorm.DB
	history ProductHistory
	teams   TeamCodes
}

// compile-time proof Service satisfies the generated handler interfaces — the catalogue and its bundles
// (docs/business/product/product_bundle.md). A forgotten RPC fails the build here instead of answering Unimplemented.
var (
	_ productv1connect.ProductServiceHandler = (*Service)(nil)
	_ productv1connect.BundleServiceHandler  = (*Service)(nil)
)

// NewService takes the product's HISTORY reader — inventory and the order side, joined at the composition root — which
// ProductDelete asks before it removes anything (a-used-product-is-archived-never-deleted), and the TEAM CODE reader
// every product code is composed from (the-field-is-product-code-composed-on-write). A nil history refuses every delete
// and every code correction; a nil team-code reader refuses every create.
func NewService(db *gorm.DB, history ProductHistory, teams TeamCodes) *Service {
	return &Service{db: db, history: history, teams: teams}
}

var errProductMissing = errors.New("product not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errProductMissing)
}

// dbError maps a duplicate product code to AlreadyExists (a client error) and everything else to Internal. The code is
// unique over EVERY row, archived ones included — but a composed code can only collide inside its own team's prefix, so
// the refusal says nothing about anybody else's catalogue.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a product with this product code already exists — an archived one keeps its code, so check the archive too"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// productExists reports whether an ACTIVE product with this id exists IN THIS TEAM. The team_id
// clause is the scope check — it is what stops one team touching another's product by id.
func productExists(tx *gorm.DB, teamID, productID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&product_service_models.Product{}).
		Where("id = ? AND team_id = ? AND archived = ?", productID, teamID, false).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}
