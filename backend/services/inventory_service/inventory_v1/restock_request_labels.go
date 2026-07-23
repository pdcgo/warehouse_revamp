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
// the same line share a batch_id — location is separate from batch.
//
// BROKEN/LOST UNITS ARE NEVER HERE, and it costs nothing to exclude them: damaged units produce no
// `restock_received_placements` row (they never entered stock, #154), so a query over placements omits
// them by construction rather than by a filter that could be forgotten.
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
	var rr inventory_service_models.RestockRequest

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
	if rr.Status != restockStatusFulfilled {
		return nil, restockErr(errRestockNotFulfilled)
	}

	// One row per placement. The HPP is the accept screen's figure (#155) recomputed for THIS receipt —
	// the same arithmetic as unitCosts (stock_cost.go), but scoped to this request rather than the
	// product's latest restock, which a newer delivery could have moved. Freight is spread over the
	// request's sellable units, so every unit of the delivery carries the same share.
	type labelRow struct {
		BatchID   uint64
		ProductID uint64
		SKU       string
		Name      string
		Quantity  int64
		RackID    *uint64
		RackCode  *string
		HPP       int64
	}

	var rows []labelRow

	err = s.db.
		WithContext(ctx).
		Raw(`
			SELECT
			    i.id          AS batch_id,
			    i.product_id  AS product_id,
			    i.sku         AS sku,
			    i.name        AS name,
			    p.quantity    AS quantity,
			    p.rack_id     AS rack_id,
			    rk.code       AS rack_code,
			    ((i.total_price / NULLIF(i.received_quantity, 0))
			     + COALESCE(
			           (r.shipping_cost + r.cod_shipping_fee)
			           / NULLIF((SELECT SUM(x.received_quantity)::BIGINT
			                     FROM restock_request_items x
			                     WHERE x.restock_request_id = r.id), 0),
			           0)
			    ) AS hpp
			FROM restock_request_items i
			JOIN restock_requests r            ON r.id = i.restock_request_id
			JOIN restock_received_placements p ON p.restock_request_item_id = i.id
			LEFT JOIN racks rk                 ON rk.id = p.rack_id
			WHERE r.id = ?
			  AND r.warehouse_id = ?
			  AND r.status = ?
			  AND i.received_quantity > 0
			ORDER BY i.id, p.rack_id NULLS LAST`,
			requestID, warehouseID, restockStatusFulfilled,
		).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The units that got NO label because they never entered stock (#154) — stated so a short run reads
	// as deliberate. A separate scalar query rather than a join: damage lives in its own table and must
	// not multiply the placement rows above.
	var excluded int64

	err = s.db.
		WithContext(ctx).
		Raw(`
			SELECT COALESCE(SUM(d.quantity), 0)
			FROM restock_damaged_units d
			JOIN restock_request_items i ON i.id = d.restock_request_item_id
			WHERE i.restock_request_id = ?`,
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

		// A nil rack is the unplaced/holding pile — a real place (#135), said out loud rather than
		// printed as a blank shelf a picker would go looking for.
		if rows[i].RackID != nil && rows[i].RackCode != nil {
			label.RackCode = *rows[i].RackCode
		} else {
			label.Unplaced = true
		}

		labels = append(labels, label)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestLabelsResponse{
		RestockId:      rr.ID,
		ReceivedAtUnix: rr.UpdatedAt.Unix(),
		Labels:         labels,
		ExcludedCount:  excluded,
	}), nil
}
