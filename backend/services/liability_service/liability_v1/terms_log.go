package liability_v1

import (
	"context"

	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// isOverride answers whether this write is somebody reaching into a team that is not theirs
// (terms-are-team-scoped-root-is-global).
//
// ⚠ IT READS THE ROLE THE INTERCEPTOR RESOLVED, never anything the caller sent. A caller cannot be
// trusted to report that its own write was an override — that is the one fact it has a reason to
// misreport.
//
// ROLE_UNSPECIFIED means the caller holds no role in the CREDITOR team. The request got in, so it was
// authorized; holding no role there means it was authorized by the root-team bypass instead. That is
// exactly what an override is.
//
// ⚠ A DIRECT DOMAIN CALL (a test, a CLI command) ALSO READS AS UNSPECIFIED, and recording those as
// overrides is the right way round: an unattributed write to somebody's credit limit is the case that
// most deserves a second look, and the alternative — defaulting to "not an override" — would make the
// flag silently absent exactly where the audit trail thins out.
func isOverride(ctx context.Context) bool {
	return san_auth.GetCallerRole(ctx) == role_basev1.Role_ROLE_UNSPECIFIED
}

// recordTermsChange writes one row of the limit history.
//
// ⚠ IT TAKES `tx`, AND THE CALLER MUST BE IN A TRANSACTION. The terms row and the log entry are one
// act: a limit that changed with no record of who changed it is precisely the back door
// a-limit-change-is-recorded exists to close, and it is worse than either the change or the log
// failing outright — nobody would know to look.
//
// `before` is nil for the FIRST terms a pair has ever had, which reads correctly on the screen: the
// old values are all "nothing set", because they were.
func recordTermsChange(
	ctx context.Context,
	tx *gorm.DB,
	teamID, counterpartyID uint64,
	before, after *liability_service_models.LiabilityTerms,
	reason string,
) error {
	entry := liability_service_models.LiabilityTermsLog{
		TeamID:         teamID,
		CounterpartyID: counterpartyID,
		ActorID:        actorUserID(ctx),
		Reason:         reason,
		Override:       isOverride(ctx),
	}

	if before != nil {
		entry.OldCreditLimit = before.CreditLimit
		entry.OldHandlingFee = before.HandlingFee
		entry.OldProductMarkupBp = before.ProductMarkupBP
	}

	// `after` is nil for a DELETE, and every "new" value then stays at its zero — except the limit,
	// which stays NULL. That is the correct reading and the reason the column is nullable: deleting a
	// pair's terms drops them back to the default, which is an ABSENCE of a limit, not a limit of 0.
	// Recording 0 there would say the team was frozen by the act that un-restricted them.
	if after != nil {
		entry.NewCreditLimit = after.CreditLimit
		entry.NewHandlingFee = after.HandlingFee
		entry.NewProductMarkupBp = after.ProductMarkupBP
	}

	return tx.Create(&entry).Error
}
