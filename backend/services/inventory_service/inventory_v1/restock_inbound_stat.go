package inventory_v1

import (
	"context"
	"database/sql"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockInboundStat is the headline over the warehouse's inbound queue (owner): how many different
// products are coming, how many pieces, what they are worth, and how long the oldest box has waited.
//
// It is a SEPARATE READ rather than a total of the visible page, for the reason OwnerStockStat gives
// on the other side: the page is twenty rows of a paginated list, so adding those up would make the
// headline move whenever somebody turned a page — and describe page 1 of 6 while looking like a total.
//
// The scope is `warehouse_id = team`, which is the RECEIVING side and the mirror of OwnerStockStat's
// `requesting_team_id = team`. A restock this warehouse is not the target of can never be counted here,
// whatever the filter asks for.
func (s *Service) RestockInboundStat(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockInboundStatRequest],
) (*connect.Response[inventoryv1.RestockInboundStatResponse], error) {
	teamID := req.Msg.GetTeamId()
	requesterID := req.Msg.GetFilter().GetRequestingTeamId()

	db := s.db.WithContext(ctx)

	// The lens as a pair of SQL fragments, exactly as OwnerStockStat does it: `? = 0` disables the
	// clause, so one statement serves both "from everyone" and "from this team" without building a
	// WHERE by string concatenation.
	//
	// COUNT(DISTINCT product_id) is the point of the first column: the same SKU on four deliveries is
	// ONE thing to find a shelf for, and counting the lines instead would report four.
	const linesSQL = `
		SELECT COUNT(DISTINCT ri.product_id) AS product_count,
		       COALESCE(SUM(ri.quantity), 0) AS unit_count,
		       COALESCE(SUM(ri.total_price), 0) AS amount
		FROM restock_request_items ri
		JOIN restock_requests r ON r.id = ri.restock_request_id
		WHERE r.warehouse_id = ? AND r.status = ? AND (? = 0 OR r.requesting_team_id = ?)`

	var lines struct {
		ProductCount int64
		UnitCount    int64
		Amount       int64
	}

	err := db.
		Raw(linesSQL, teamID, restockStatusPending, requesterID, requesterID).
		Scan(&lines).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Over the REQUESTS, not their lines — a request waits at the door whether or not anything joins
	// to it, and both figures here would silently skip a line-less one if they rode the item join. That
	// is also why the count cannot come from the query above: it joins the items, so a delivery of two
	// products would be counted twice.
	//
	// MIN over no rows is NULL rather than 0, so the scan target has to be nullable or the driver
	// errors on the conversion.
	const requestsSQL = `
		SELECT COUNT(*) AS restock_count, MIN(r.created_at) AS oldest
		FROM restock_requests r
		WHERE r.warehouse_id = ? AND r.status = ? AND (? = 0 OR r.requesting_team_id = ?)`

	var requests struct {
		RestockCount int64
		Oldest       sql.NullTime
	}

	err = db.
		Raw(requestsSQL, teamID, restockStatusPending, requesterID, requesterID).
		Scan(&requests).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	preview := &inventoryv1.RestockInboundPreview{
		RestockCount: requests.RestockCount,
		ProductCount: lines.ProductCount,
		UnitCount:    lines.UnitCount,
		Amount:       lines.Amount,
	}

	if requests.Oldest.Valid {
		preview.OldestPendingUnix = requests.Oldest.Time.Unix()
	}

	return connect.NewResponse(&inventoryv1.RestockInboundStatResponse{Preview: preview}), nil
}
