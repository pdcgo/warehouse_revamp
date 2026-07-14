package team_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamInfoUpdate implements [teamv1connect.TeamServiceHandler].
//
// THE CANONICAL SCOPED RPC. The handler contains ZERO authorization code: the interceptor has
// already established that the caller holds one of the policy's roles IN team_id (the field
// tagged use_scope). If this works, the whole roling mechanism works.
//
// Two bugs from the source are fixed here, and both were silent data loss:
//
//  1. DUPLICATE ROWS. The source did load-then-Save with no transaction, no lock and no unique
//     index — two concurrent updates on a team with no info row both missed, both inserted, and
//     produced two rows for one team. We upsert against a UNIQUE index instead, so the database
//     makes the race impossible rather than the code trying to avoid it.
//
//  2. SILENT BLANKING. The source assigned all six fields unconditionally, so a client sending
//     only contact_number wiped the bank details. Every field is now `optional` — absent means
//     leave alone, present-and-zero means clear.
func (s *Service) TeamInfoUpdate(
	ctx context.Context,
	req *connect.Request[teamv1.TeamInfoUpdateRequest],
) (*connect.Response[teamv1.TeamInfoUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	// Build the update from PRESENT fields only. An absent field is not in the map, so it is
	// not touched.
	updates := map[string]any{}

	if req.Msg.ContactNumber != nil {
		updates["contact_number"] = req.Msg.GetContactNumber()
	}

	if req.Msg.BankType != nil {
		updates["bank_type"] = req.Msg.GetBankType()
	}

	if req.Msg.BankOwnerName != nil {
		updates["bank_owner_name"] = req.Msg.GetBankOwnerName()
	}

	if req.Msg.BankAccountNumber != nil {
		updates["bank_account_number"] = req.Msg.GetBankAccountNumber()
	}

	// present-and-zero clears to NULL; absent leaves the existing value alone.
	if req.Msg.ReturnWarehouseId != nil {
		updates["return_warehouse_id"] = nullableID(req.Msg.GetReturnWarehouseId())
	}

	if req.Msg.ReturnUserId != nil {
		updates["return_user_id"] = nullableID(req.Msg.GetReturnUserId())
	}

	var info team_service_models.TeamInfo

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := teamExists(tx, teamID)
		if err != nil {
			return err
		}

		if !exists {
			return errTeamMissing
		}

		// The upsert. ON CONFLICT (team_id) is only possible because of the UNIQUE index —
		// that index IS the fix for the duplicate-row race.
		//
		// The present values are applied to BOTH paths: onto `row` for the INSERT (no existing
		// info row) and via DoUpdates for the UPDATE (conflict). Populating only DoUpdates would
		// silently drop every field on first write — a latent bug hidden in normal flow because
		// TeamCreate happens to pre-create an empty info row, so the insert path is rarely hit.
		row := team_service_models.TeamInfo{TeamID: teamID}
		applyInfoValues(&row, updates)

		err = tx.
			Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "team_id"}},
				DoUpdates: clause.Assignments(withUpdatedAt(updates)),
			}).
			Create(&row).
			Error
		if err != nil {
			return err
		}

		return tx.
			Where("team_id = ?", teamID).
			First(&info).
			Error
	})
	if err != nil {
		if err == errTeamMissing {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&teamv1.TeamInfoUpdateResponse{Info: teamInfoToProto(&info)}), nil
}

// applyInfoValues copies the present-column map onto the struct, so the INSERT path of the
// upsert writes the same values the UPDATE path (DoUpdates) would. Kept in lockstep with the
// map-building above: one source of "what is present", applied to both paths.
func applyInfoValues(row *team_service_models.TeamInfo, updates map[string]any) {
	if v, ok := updates["contact_number"].(string); ok {
		row.ContactNumber = v
	}

	if v, ok := updates["bank_type"].(string); ok {
		row.BankType = v
	}

	if v, ok := updates["bank_owner_name"].(string); ok {
		row.BankOwnerName = v
	}

	if v, ok := updates["bank_account_number"].(string); ok {
		row.BankAccountNumber = v
	}

	// Present return ids are stored as *uint64 (nullableID gives nil for a present-zero clear).
	if v, ok := updates["return_warehouse_id"].(uint64); ok {
		row.ReturnWarehouseID = &v
	}

	if v, ok := updates["return_user_id"].(uint64); ok {
		row.ReturnUserID = &v
	}
}

// nullableID maps 0 -> NULL. The proto's `optional` already distinguishes absent from present,
// so a present zero is an explicit "clear it".
func nullableID(id uint64) any {
	if id == 0 {
		return nil
	}

	return id
}

// withUpdatedAt ensures updated_at moves. Postgres has no auto-update on UPDATE, and adding a
// trigger would hide it — keep it visible in the query.
func withUpdatedAt(updates map[string]any) map[string]any {
	out := make(map[string]any, len(updates)+1)

	for key, value := range updates {
		out[key] = value
	}

	out["updated_at"] = gorm.Expr("NOW()")

	return out
}
