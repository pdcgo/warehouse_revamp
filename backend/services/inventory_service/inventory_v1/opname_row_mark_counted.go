package inventory_v1

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRowMarkCounted closes a revealed row with its drafts (a-row-is-marked-counted-after-its-drafts):
//
//   - broken: the units taken off this rack and thrown away — the counter's number, no cap
//     (broken-posts-as-written-the-rest-nets);
//   - lost: the shortage less the broken, at least 0 — the system's (a-short-rack-gets-a-lost-draft-from-the-system);
//   - surplus: the count less the book — the system's (a-surplus-draft-is-counted-by-the-system).
//
// Every draft that exists needs its typed reason, or the row is refused (a-difference-needs-its-reason-on-the-draft).
// Then the row is `counted`, read-only to its counter until the admin sends it back.
func (s *Service) OpnameRowMarkCounted(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRowMarkCountedRequest],
) (*connect.Response[inventoryv1.OpnameRowMarkCountedResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	broken := req.Msg.GetBrokenCount()
	brokenNote := strings.TrimSpace(req.Msg.GetBrokenNote())
	lostNote := strings.TrimSpace(req.Msg.GetLostNote())
	surplusNote := strings.TrimSpace(req.Msg.GetSurplusNote())

	var row models.OpnameSessionSnapshot

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		_, row, lockErr = lockOpnameRow(tx, warehouseID, req.Msg.GetRowId())
		if lockErr != nil {
			return lockErr
		}

		if row.Status == models.OpnameRowCounted {
			return errOpnameRowCounted
		}

		if !row.Revealed() {
			return errOpnameNotRevealed
		}

		short := row.SystemStockCount - row.Count()
		lost := max(short-broken, 0)
		surplus := max(row.Count()-row.SystemStockCount, 0)

		for _, need := range []struct {
			kind string
			n    int64
			note string
		}{{"broken", broken, brokenNote}, {"lost", lost, lostNote}, {"surplus", surplus, surplusNote}} {
			if need.n > 0 && need.note == "" {
				return fmt.Errorf("%w: the %s draft has none", errOpnameReasonMissing, need.kind)
			}
		}

		deleteErr := deleteOpnameDrafts(tx, row, true)
		if deleteErr != nil {
			return deleteErr
		}

		var problems []models.OpnameProblemsDraft

		for _, d := range []struct {
			kind models.ProblemType
			n    int64
			note string
		}{{models.ProblemBroken, broken, brokenNote}, {models.ProblemLost, lost, lostNote}} {
			if d.n == 0 {
				continue
			}

			problems = append(problems, models.OpnameProblemsDraft{
				WarehouseID: row.WarehouseID, TeamID: row.TeamID, ProductID: row.ProductID, PlacementID: row.PlacementID,
				OpnameSessionID: row.OpnameSessionID, Note: d.note, ProblemType: d.kind, ProblemStockCount: d.n,
			})
		}

		if len(problems) > 0 {
			createErr := tx.Create(&problems).Error
			if createErr != nil {
				return createErr
			}
		}

		if surplus > 0 {
			createErr := tx.Create(&models.OpnameSurplusDraft{
				WarehouseID: row.WarehouseID, TeamID: row.TeamID, ProductID: row.ProductID, PlacementID: row.PlacementID,
				OpnameSessionID: row.OpnameSessionID, Note: surplusNote, SurplusStockCount: surplus,
			}).Error
			if createErr != nil {
				return createErr
			}
		}

		row.Status = models.OpnameRowCounted

		return tx.Model(&models.OpnameSessionSnapshot{}).Where("id = ?", row.ID).Update("status", models.OpnameRowCounted).Error
	})
	if err != nil {
		return nil, opnameErr(err)
	}

	mapped, err := opnameRowsProto(s.db.WithContext(ctx), row.OpnameSessionID, []models.OpnameSessionSnapshot{row}, nil, true)
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameRowMarkCountedResponse{Row: mapped[0]}), nil
}
