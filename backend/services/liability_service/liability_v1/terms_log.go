package liability_v1

import (
	"context"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// isOverride answers whether this write is somebody reaching into a team that is not theirs
// (terms-are-team-scoped-root-is-global, an-override-is-stamped-in-every-service). It stamps the terms log, a payment's
// record and confirm, a payment request, and the ledger legs of a posting a person made.
//
// ⚠ IT READS THE ROLE THE INTERCEPTOR RESOLVED, never anything the caller sent. A caller cannot be
// trusted to report that its own write was an override — that is the one fact it has a reason to
// misreport.
//
// It is san_auth.IsOverride — the ONE rule every service stamps by, so it cannot drift here. A scoped request whose
// caller holds no role in the team got in by the root-team bypass, which is exactly what an override is.
//
// ⚠ A CALL WITH NO PERSON OR NO SCOPE READS FALSE. This used to read ROLE_UNSPECIFIED alone, so a direct domain call
// also counted as an override — right for the terms log, whose every write is a scoped RPC, and wrong the moment the
// same answer stamps the ledger, where an event consumer posts with no caller at all: its legs would all have read as
// the platform reaching in.
func isOverride(ctx context.Context) bool {
	return san_auth.IsOverride(ctx)
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
	}

	// `after` is nil for a DELETE, and every "new" value then stays at its zero — except the limit,
	// which stays NULL. That is the correct reading and the reason the column is nullable: deleting a
	// pair's terms drops them back to the default, which is an ABSENCE of a limit, not a limit of 0.
	// Recording 0 there would say the team was frozen by the act that un-restricted them.
	if after != nil {
		entry.NewCreditLimit = after.CreditLimit
	}

	return tx.Create(&entry).Error
}
