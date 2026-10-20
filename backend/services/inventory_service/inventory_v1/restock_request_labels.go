package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestLabels returns one printable label per PLACEMENT of a FULFILLED restock (#207) — the
// stickers a warehouse prints after accepting a delivery so a picker can find and scan what it just
// shelved.
//
// ONE LABEL PER PLACEMENT, not per line: a delivery of 100 split across three shelves is three labels,
// each carrying its own rack and quantity, because a sticker names ONE physical spot. Two shelves of
// the same batch share its batch_id — location is separate from batch.
//
// BROKEN/LOST UNITS ARE NEVER HERE, and it costs nothing to exclude them: damaged units put nothing on a rack (they
// never entered stock, #154), so a query over the accept's rack rows omits them by construction.
//
// Scoped to the ACCEPTING warehouse (`team_id`/use_scope). A request belonging to another warehouse
// reads as NotFound, exactly as Detail and Fulfill do — the id itself must not confirm it exists.
func (s *Service) RestockRequestLabels(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestLabelsRequest],
) (*connect.Response[inventoryv1.RestockRequestLabelsResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	requestID := req.Msg.GetRequestId()

	// The receipt itself, scoped — its id and acceptance time head every label. A missing or
	// cross-warehouse request is NotFound via restockErr's gorm mapping.
	var rr inventory_service_models.Restock

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND warehouse_id = ?", requestID, warehouseID).
		First(&rr).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	// Only a delivery that HAPPENED has anything to print. A pending request has no placements yet and
	// a cancelled one never will — refused rather than returned empty, so the screen can say why.
	if rr.Status != restockStatusAccepted {
		return nil, restockErr(errRestockNotAccepted)
	}

	// One row per rack the accept put units on. The HPP is the batch's own landed price
	// (unit-price-is-line-price-plus-costs-per-unit) — freight included, the figure the ledger values the units at.
	type labelRow struct {
		BatchID   uint64
		ProductID uint64
		SKU       string
		Name      string
		Quantity  int64
		RackID    uint64
		RackCode  string
		HPP       float64
	}

	var rows []labelRow

	err = s.db.
		WithContext(ctx).
		Raw(`
			SELECT
			    b.id                         AS batch_id,
			    b.product_id                 AS product_id,
			    i.sku                        AS sku,
			    i.name                       AS name,
			    l.stock_change               AS quantity,
			    l.placement_id               AS rack_id,
			    rk.code                      AS rack_code,
			    b.price_unit                 AS hpp
			FROM restocks r
			JOIN batches b                 ON b.transaction_id = r.transaction_id
			JOIN restock_items i           ON i.restock_id = r.id AND i.product_id = b.product_id
			JOIN product_placement_logs l  ON l.transaction_id = r.transaction_id AND l.product_id = b.product_id
			                              AND l.stock_change > 0
			JOIN placements rk                ON rk.id = l.placement_id
			WHERE r.id = ?
			  AND r.warehouse_id = ?
			  AND r.status = ?
			ORDER BY b.id, l.placement_id`,
			requestID, warehouseID, restockStatusAccepted,
		).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The units that got NO label because they never entered stock (#154) — stated so a short run reads
	// as deliberate. A separate scalar query rather than a join: the problem rows live in their own table and must
	// not multiply the placement rows above.
	var excluded int64

	err = s.db.
		WithContext(ctx).
		Raw(`
			SELECT COALESCE(SUM(p.count), 0)
			FROM restock_problem_items p
			WHERE p.restock_id = ?`,
			requestID,
		).
		Scan(&excluded).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	labels := make([]*inventoryv1.RestockLabel, 0, len(rows))
	for i := range rows {
		label := &inventoryv1.RestockLabel{
			ProductId: rows[i].ProductID,
			Sku:       rows[i].SKU,
			Name:      rows[i].Name,
			BatchId:   rows[i].BatchID,
			Quantity:  rows[i].Quantity,
			Hpp:       rows[i].HPP,
		}

		label.PlacementCode = rows[i].RackCode

		labels = append(labels, label)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestLabelsResponse{
		RestockId:      rr.ID,
		ReceivedAtUnix: rr.UpdatedAt.Unix(),
		Labels:         labels,
		ExcludedCount:  excluded,
	}), nil
}
