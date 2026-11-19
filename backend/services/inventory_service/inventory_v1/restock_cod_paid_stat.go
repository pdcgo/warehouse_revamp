package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockCodPaidStat is the warehouse list's *Ongkir COD dibayar* card (the-warehouse-sees-the-cod-it-paid): the
// courier's charge the warehouse handed over at the door on the restocks it ACCEPTED in the window, summed, and how many
// carried one.
//
//	which money   `warehouse_additional_cost` — the courier's incidental charge, paid by the warehouse on site and owed
//	              back by the selling team (the-warehouse-cost-is-the-couriers-charge-at-the-door). The warehouse's own
//	              money: never the restock's value, never the selling team's freight.
//	which restocks the ones going TO this warehouse (`warehouse_id` = the scoped team), accepted, with `accepted_at` in
//	              the window, both ends inclusive — the list's accepted-date filter's bounds (applyRestockDateRange).
//	              The charge is final at the accept (one per restock, the-courier-is-paid-once-per-restock — Terima's figure
//	              replaces one noted at Tandai Tiba, the-courier-charge-is-noted-at-tiba-and-final-at-terima), so an
//	              accepted restock's charge is final; one only noted at Tiba is not counted until it is.
//	how many      only the restocks that carried a charge (above 0): the card's line says how many it PAID on.
//
// ONE aggregate over the warehouse's accepted restocks in the window.
func (s *Service) RestockCodPaidStat(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockCodPaidStatRequest],
) (*connect.Response[inventoryv1.RestockCodPaidStatResponse], error) {
	var row struct {
		Restocks int64
		Amount   float64
	}

	err := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.Restock{}).
		Select("COUNT(*) AS restocks, COALESCE(SUM(warehouse_additional_cost), 0) AS amount").
		Where("warehouse_id = ?", req.Msg.GetTeamId()).
		Where("status = ?", restockStatusAccepted).
		Where("accepted_at >= ? AND accepted_at <= ?", time.Unix(req.Msg.GetFromUnix(), 0), time.Unix(req.Msg.GetToUnix(), 0)).
		Where("warehouse_additional_cost > 0").
		Scan(&row).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockCodPaidStatResponse{
		RestockCount: row.Restocks,
		Amount:       row.Amount,
	}), nil
}
