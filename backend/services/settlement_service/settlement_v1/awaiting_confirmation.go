package settlement_v1

import (
	"context"

	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// awaitingConfirmation counts, per counterparty, the payments THEY have recorded that THIS team has
// not yet confirmed (#188 Q10).
//
// A creditor must learn a payment is waiting without hunting for it — a payment nobody notices is a
// debt that stays open for no reason. Answered inside the query the position screen already makes
// rather than by a second RPC, so the badge and the rows cannot disagree.
//
// ⚠ ONLY WHERE THIS TEAM IS THE CREDITOR. A payment this team RECORDED is waiting on somebody else
// and must never appear in its own badge — counting both sides would show every payer a permanent
// notification for work that is not theirs, which is how a badge stops meaning anything.
//
// Only RECORDED counts. A confirmed payment is done, and a reversed one has been dealt with twice.
func (s *Service) awaitingConfirmation(ctx context.Context, teamID uint64) (map[uint64]uint32, error) {
	type row struct {
		PayerTeamID uint64
		Waiting     uint32
	}

	var rows []row

	err := s.db.
		WithContext(ctx).
		Model(&settlement_service_models.SettlementPayment{}).
		Select("payer_team_id, COUNT(*) AS waiting").
		Where("creditor_team_id = ? AND status = ?", teamID, paymentRecorded).
		Group("payer_team_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	// Keyed by the COUNTERPARTY, which on this side of the relationship is the payer — the same key the
	// position rows use, so the badge lands on the right line without a second lookup.
	waiting := make(map[uint64]uint32, len(rows))
	for i := range rows {
		waiting[rows[i].PayerTeamID] = rows[i].Waiting
	}

	return waiting, nil
}
