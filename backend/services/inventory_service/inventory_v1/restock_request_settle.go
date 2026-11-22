package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestSettle is the restock's SELLING team's *Tandai Selesai* (a-restock-problem-is-settled-by-resolution-rows,
// 🔄 B: no units on a row — the seller marks the restock settled when it is done): the settled mark on the restock —
// when, by whom, whether as an override — and its problem tags (*Barang kurang* / *Barang rusak*) off, in ONE
// transaction under the restock row's lock. Allowed on what takes resolutions (a problem restock, a lost one) that is
// not settled yet; no resolution row is required (the accepted dialog warns, it does not refuse). A settled restock
// still takes resolution rows and stays settled; an inbound parcel's Terima with short or broken units lifts the mark
// again (custom_shipment_receive.go).
func (s *Service) RestockRequestSettle(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestSettleRequest],
) (*connect.Response[inventoryv1.RestockRequestSettleResponse], error) {
	teamID := req.Msg.GetTeamId()
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rr, lockErr := lockSellingRestock(tx, req.Msg.GetRequestId(), teamID)
		if lockErr != nil {
			return lockErr
		}

		if rr.SettledAt != nil {
			return errRestockAlreadySettled
		}

		eligibleErr := restockTakesResolutions(tx, rr)
		if eligibleErr != nil {
			return eligibleErr
		}

		now := time.Now()

		updateErr := tx.
			Model(rr).
			Updates(map[string]any{
				"settled_at":             now,
				"settled_by_user_id":     actor,
				"settled_by_is_override": override,
				"updated_at":             now,
			}).
			Error
		if updateErr != nil {
			return updateErr
		}

		// The Riwayat's row for it, at the mark's own instant (restock_settlement_log.go).
		logErr := recordSettledLog(tx, rr, actor, override, now)
		if logErr != nil {
			return logErr
		}

		return takeProblemTagsOff(tx, rr.ID)
	})
	if err != nil {
		return nil, resolutionErr(err)
	}

	wire, err := s.restockDetail(ctx, req.Msg.GetRequestId(), teamID)
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestSettleResponse{Request: wire}), nil
}
