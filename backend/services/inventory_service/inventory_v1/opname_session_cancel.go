package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameSessionCancel calls an active count off: every row is released and nothing is posted; the counted rows and their
// drafts stay for the record (the-lock-is-the-open-snapshot-row, an-abandoned-count-waits-for-the-admin). The session is
// locked FOR UPDATE first, so a row being counted at that second finishes or is refused — never half-cancelled.
func (s *Service) OpnameSessionCancel(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameSessionCancelRequest],
) (*connect.Response[inventoryv1.OpnameSessionCancelResponse], error) {
	var session models.OpnameSession

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		session, lockErr = opnameSessionOf(tx, req.Msg.GetTeamId(), req.Msg.GetSessionId(), "UPDATE")
		if lockErr != nil {
			return lockErr
		}

		if session.Status != models.OpnameActive {
			return errOpnameNotActive
		}

		session.Status = models.OpnameCancel

		updateErr := tx.Model(&models.OpnameSession{}).Where("id = ?", session.ID).Update("status", models.OpnameCancel).Error
		if updateErr != nil {
			return updateErr
		}

		return tx.Model(&models.OpnameSessionSnapshot{}).
			Where("opname_session_id = ? AND released_at IS NULL", session.ID).
			Update("released_at", gorm.Expr("NOW()")).Error
	})
	if err != nil {
		return nil, opnameErr(err)
	}

	progress, err := opnameProgressOf(s.db.WithContext(ctx), []models.OpnameSession{session})
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameSessionCancelResponse{
		Session: opnameSessionProto(session, progress[session.ID], false),
	}), nil
}
