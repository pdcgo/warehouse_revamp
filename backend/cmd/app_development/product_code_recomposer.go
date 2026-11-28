package main

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// productCodeRecomposer joins team_service to product_service (backlog #149, a-team-code-change-recomposes-its-product-codes):
// a team code change gives the team's products the new code.
//
// The liabilityPoster shape: team_service declares the interface in its own terms (team_v1.ProductCodeRecomposer), this
// adapter is the whole dependency between the two, and it calls a DOMAIN function rather than an RPC, passing the
// caller's transaction straight through — the team code, its former code, every product code, the history lines, the
// `need_reprint_code` tags and the reprint waits commit as one. Rewriting a team's product codes has no wire surface of
// its own: it happens only inside TeamCodeUpdate.
type productCodeRecomposer struct {
	products *product_v1.Service
}

func NewProductCodeRecomposer(products *product_v1.Service) team_v1.ProductCodeRecomposer {
	return &productCodeRecomposer{products: products}
}

func (r *productCodeRecomposer) RecomposeTeamCodes(
	ctx context.Context,
	tx *gorm.DB,
	change team_v1.TeamCodeChange,
) (team_v1.RecomposedProducts, error) {
	report, err := r.products.RecomposeTeamCodes(ctx, tx, change.TeamID, change.OldCode, change.NewCode, product_v1.RecomposeActor{
		UserID:     change.ActorID,
		IsOverride: change.IsOverride,
	})
	if errors.Is(err, product_v1.ErrTeamRecomposeClash) {
		// team_service answers its own sentinel (AlreadyExists); the message keeps product_service's words, naming the product.
		return team_v1.RecomposedProducts{}, fmt.Errorf("%w — %s", team_v1.ErrProductCodeClash, err.Error())
	}

	if err != nil {
		return team_v1.RecomposedProducts{}, err
	}

	return team_v1.RecomposedProducts{
		Recomposed:     report.Recomposed,
		Tagged:         report.Tagged,
		LeftAlone:      report.LeftAlone,
		LeftAloneCodes: report.LeftAloneCodes,
	}, nil
}

// PreviewTeamCodes is the same change, only read — TeamCodePreview's figures (backlog #150): product_service counts the
// products the recompose would move, picks the example and asks the same shelves, on the caller's db.
func (r *productCodeRecomposer) PreviewTeamCodes(
	ctx context.Context,
	db *gorm.DB,
	change team_v1.TeamCodeChange,
) (team_v1.ProductsPreview, error) {
	preview, err := r.products.PreviewTeamRecompose(ctx, db, change.TeamID, change.OldCode, change.NewCode)
	if err != nil {
		return team_v1.ProductsPreview{}, err
	}

	return team_v1.ProductsPreview{
		Products:     preview.Products,
		ExampleOld:   preview.ExampleOld,
		ExampleNew:   preview.ExampleNew,
		WarehouseIDs: preview.WarehouseIDs,
	}, nil
}
