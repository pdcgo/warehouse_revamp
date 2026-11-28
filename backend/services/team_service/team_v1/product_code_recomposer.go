package team_v1

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// ProductCodeRecomposer is how a team code change reaches the team's products (backlog #149,
// a-team-code-change-recomposes-its-product-codes) — an interface THIS service owns, in its own terms, as inventory owns
// LiabilityPoster: team_service never imports product_service, and the composition root
// (cmd/app_development/product_code_recomposer.go) is the whole dependency between them.
//
// Like LiabilityPoster it takes the CALLER'S TRANSACTION: the new team code, the former one kept, every product code, the
// history lines, the `need_reprint_code` tags and the warehouses' reprint waits commit as ONE — a product never carries a
// code its team no longer has, and a refused recompose leaves the team code as it was. It is not an RPC and deliberately is
// not one: nothing outside the team code edit may rewrite a team's product codes.
type ProductCodeRecomposer interface {
	RecomposeTeamCodes(ctx context.Context, tx *gorm.DB, change TeamCodeChange) (RecomposedProducts, error)
	// PreviewTeamCodes says what RecomposeTeamCodes WOULD do to the same change — TeamCodePreview's figures (backlog
	// #150), read on the caller's db, never in a transaction and never writing. Its ActorID / IsOverride go unread.
	PreviewTeamCodes(ctx context.Context, db *gorm.DB, change TeamCodeChange) (ProductsPreview, error)
}

// ProductsPreview is what a team code change would do to the team's products — the confirm's figures.
type ProductsPreview struct {
	// Products that would take the new code (every one under `<old code>-`, archived ones too).
	Products int
	// One of them, old → new, an active product first; both empty when Products is 0.
	ExampleOld string
	ExampleNew string
	// The warehouses holding units of those products on a shelf now — each would reprint. Sorted.
	WarehouseIDs []uint64
}

// TeamCodeChange is one team code edit: whose, from what, to what, and who made it.
type TeamCodeChange struct {
	TeamID  uint64
	OldCode string
	NewCode string
	// The person who changed it (0 = none recorded) and whether they were Root or the Administrator outside the team
	// (an-override-is-stamped-in-every-service) — written on each product's history line.
	ActorID    uint64
	IsOverride bool
}

// RecomposedProducts is what the change did to the team's products — TeamCodeUpdate's answer.
type RecomposedProducts struct {
	// Products that took the new code (every one under `<old code>-`, archived ones too).
	Recomposed int
	// Of them, those some warehouse holds stock of — tagged `need_reprint_code`.
	Tagged int
	// Products NOT under `<old code>-`, left as they were; LeftAloneCodes names the first few.
	LeftAlone      int
	LeftAloneCodes []string
}

// ErrProductCodeClash is a recompose refused because one of the team's products would take a code another product already
// carries (a team code with a dash: AB + C-1 and AB-C + 1 compose alike). The whole change is refused — AlreadyExists, the
// message naming the product.
var ErrProductCodeClash = errors.New("a product of the team would take a code another product already carries")
