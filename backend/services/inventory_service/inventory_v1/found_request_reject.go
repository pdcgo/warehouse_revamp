package inventory_v1

import (
	"context"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// FoundRequestReject rejects a waiting found request, with a reason the reporter reads: nothing posts
// (an-adjust-found-waits-for-the-owner-or-admin). The warehouse Owner or Admin rejects any; the person who reported it
// may reject — withdraw — their own, staff included, and it is recorded as a rejection whose decider is the reporter
// (the-reporter-may-withdraw-their-found). A staff caller rejecting another's report is PermissionDenied.
//
// The request row is locked FOR UPDATE and re-read under the lock, so a rejection racing an approval (or a count's
// finalize settling it) finds it no longer waiting when it gets the row: exactly one of them decides it.
func (s *Service) FoundRequestReject(
	ctx context.Context,
	req *connect.Request[inventoryv1.FoundRequestRejectRequest],
) (*connect.Response[inventoryv1.FoundRequestRejectResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	actor := actorFrom(ctx)
	reason := strings.TrimSpace(req.Msg.GetReason())

	if actor == 0 {
		return nil, foundErr(errFoundNoPerson)
	}

	if reason == "" {
		return nil, foundErr(errFoundReasonMissing)
	}

	staff := isFoundStaff(ctx)

	var row models.FoundRequest

	db := s.db.WithContext(ctx)

	err := db.Transaction(func(tx *gorm.DB) error {
		var lockErr error

		row, lockErr = foundRequestOf(tx, warehouseID, req.Msg.GetFoundRequestId(), "UPDATE")
		if lockErr != nil {
			return lockErr
		}

		if staff && row.ReportedByID != actor {
			return errFoundStaffOwnOnly
		}

		if row.Status != models.FoundWaiting {
			return errFoundNotWaiting
		}

		now := time.Now()
		row.Status = models.FoundRejected
		row.DecidedByID = &actor
		row.DecidedAt = &now
		row.RejectReason = reason

		return tx.Model(&models.FoundRequest{}).Where("id = ?", row.ID).Updates(map[string]any{
			"status": models.FoundRejected, "decided_by_id": actor, "decided_at": now, "reject_reason": reason,
		}).Error
	})
	if err != nil {
		return nil, foundErr(err)
	}

	mapped, err := foundRequestsProto(db, actor, []models.FoundRequest{row})
	if err != nil {
		return nil, foundErr(err)
	}

	return connect.NewResponse(&inventoryv1.FoundRequestRejectResponse{FoundRequest: mapped[row.ID]}), nil
}
