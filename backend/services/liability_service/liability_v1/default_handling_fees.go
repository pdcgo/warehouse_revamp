package liability_v1

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// DefaultHandlingFee is one creditor's DEFAULT flat handling fee: its counterparty-0 row of liability_terms, the rate
// every debtor without a row of its own is charged (termsFor).
type DefaultHandlingFee struct {
	// The creditor — for a handling fee, the warehouse. An opaque team_service id.
	CreditorTeamID uint64
	// Flat per order, whole rupiah. 0 = it charges nothing.
	HandlingFee int64
}

// DefaultHandlingFees reads every creditor's DEFAULT row with its flat handling fee, oldest team first — what step 2 of
// the-flat-rate-is-dropped-last carries over into warehouse_service as each warehouse's rate. Exported for that
// carry-over (`san warehouse carry-over-fees`), so the read of this service's table stays in this service.
//
// A per-seller row (counterparty ≠ 0) is NOT read: one-rate-per-warehouse leaves it no equivalent.
//
// ⚠ It does not know which creditor is a warehouse. A selling team's default row (its credit limit) is read too, with
// whatever handling_fee it holds — team ids are opaque here, so the caller filters by team type.
//
// Unpaged, and bounded: the unique (team_id, counterparty_id) index allows one default row per team.
func DefaultHandlingFees(db *gorm.DB) ([]DefaultHandlingFee, error) {
	var fees []DefaultHandlingFee

	err := db.
		Model(&liability_service_models.LiabilityTerms{}).
		Select("team_id AS creditor_team_id, handling_fee").
		Where("counterparty_id = ?", 0).
		Order("team_id").
		Scan(&fees).
		Error
	if err != nil {
		return nil, err
	}

	return fees, nil
}
