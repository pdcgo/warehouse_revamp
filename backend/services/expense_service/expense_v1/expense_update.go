package expense_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

var (
	errCostMissing = errors.New("cost not found")
	// A voided row has been retracted. Editing it would quietly bring it back into the numbers, or —
	// worse — leave it retracted with different figures nobody can see.
	errCostVoided = errors.New("a voided cost cannot be edited")
)

// ExpenseUpdate corrects a cost (#169).
//
// It exists because a PERSON typed this number. Everything else in the money path is written by the
// system and frozen; this one is entered by hand, so it can be wrong, so it must be fixable. The
// alternative — void it and enter a replacement — loses who recorded the original and when.
//
// A FULL REPLACE, not a patch: the edit form is the record re-opened, so every field comes back and an
// empty one means cleared. It writes with a COLUMN MAP rather than a struct, because GORM skips a
// struct's zero values — which would silently keep the old note or shop while the form showed them
// gone. Exactly the trap RestockRequestUpdate documents (#131).
func (s *Service) ExpenseUpdate(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseUpdateRequest],
) (*connect.Response[expensev1.ExpenseUpdateResponse], error) {
	occurred, err := parseDate(req.Msg.GetOccurredAt())
	if err != nil {
		return nil, costErr(err)
	}

	var row expense_service_models.ExpenseRecord

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The team_id clause IS the scope check — another team's cost reads as NotFound, never
		// PermissionDenied, so a caller cannot probe for which ids exist.
		loadErr := tx.
			Where("id = ? AND team_id = ?", req.Msg.GetExpenseId(), req.Msg.GetTeamId()).
			First(&row).
			Error
		if loadErr != nil {
			return loadErr
		}

		if row.VoidedAt != nil {
			return errCostVoided
		}

		row.Kind = int32(req.Msg.GetKind())
		row.Amount = req.Msg.GetAmount()
		row.OccurredAt = occurred
		row.ShopID = req.Msg.GetShopId()
		row.Note = req.Msg.GetNote()

		return tx.
			Model(&expense_service_models.ExpenseRecord{}).
			Where("id = ?", row.ID).
			Updates(map[string]any{
				"kind":        row.Kind,
				"amount":      row.Amount,
				"occurred_at": row.OccurredAt,
				// Present in the map on purpose: clearing the shop back to "not attributed" is a real
				// edit, and a struct update would have skipped the zero and kept the old one.
				"shop_id":    row.ShopID,
				"note":       row.Note,
				"updated_at": time.Now(),
			}).
			Error
	})
	if err != nil {
		return nil, costErr(err)
	}

	return connect.NewResponse(&expensev1.ExpenseUpdateResponse{Expense: costToProto(&row)}), nil
}
