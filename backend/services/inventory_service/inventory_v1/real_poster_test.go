package inventory_v1_test

import (
	"context"
	"errors"

	"gorm.io/gorm"

	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// realPoster wires the REAL liability service through the same adapter shape the composition root uses, so a test can
// assert on rows in `liability_logs` rather than on a call being made. It is the only place in the test suite that knows
// about both services at once; in production that knowledge lives in cmd/app_development/liability_poster.go.
type realPoster struct {
	liability *liability_v1.Service
}

// PostStockDamage against the real ledger — the same direction the composition root wires: the WAREHOUSE owes the
// owner for goods it lost.
func (p *realPoster) PostStockDamage(
	ctx context.Context,
	tx *gorm.DB,
	ownerTeamID, warehouseID, movementID, actorID uint64,
	amount int64,
	kind inventory_v1.StockDamageKind,
) error {
	sourceType := liability_v1.SourceTypeBrokenGood

	switch kind {
	case inventory_v1.StockDamageLost:
		sourceType = liability_v1.SourceTypeLostGood
	case inventory_v1.StockDamageFound:
		sourceType = liability_v1.SourceTypeFound
	}

	_, err := p.liability.PostEntry(ctx, tx, liability_v1.Posting{
		DebtorTeamID:   warehouseID,
		CreditorTeamID: ownerTeamID,
		Amount:         amount,
		SourceType:     sourceType,
		SourceID:       movementID,
		Reversal:       kind == inventory_v1.StockDamageFound,
		ActorID:        actorID,
	})

	if errors.Is(err, liability_v1.ErrAlreadyPosted) {
		return nil
	}

	return err
}
