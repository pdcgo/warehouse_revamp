package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// pickLocationRow is the query's shape: one product, one rack, the quantity taken from it.
type pickLocationRow struct {
	ProductID uint64
	RackID    *uint64
	RackCode  *string
	Quantity  int64
}

// StockPickLocations returns WHERE THIS PICK'S GOODS WERE TAKEN FROM — the pick screen's shelf column
// (#151).
//
// Read from the LEDGER, not from stock_levels. StockPick recorded, per rack, exactly how much it drew
// for this ref (#149); those rows are what the order holds and they cannot drift. Current levels answer
// a different question whose answer keeps changing — another order draws from the same shelf, a
// stock-take shifts goods — and a picker sent by current levels can arrive at a shelf whose stock is
// spoken for.
//
// PICK and RETURN are NETTED, per shelf, and only a positive remainder is a stop on the walk.
//
// Reading PICK rows alone looks right and is not: the ledger is APPEND-ONLY, so a returned pick's PICK
// rows are still there (the history of "took 5, gave 5 back" has to survive). Filtering to PICK would
// therefore send a picker after a cancelled order's goods — goods that are back on the shelf and
// available to everybody else. That was this handler's first version, and its test caught it.
//
// A returned pick nets to zero on every shelf and drops out entirely. An empty list is the right answer
// to "where do I go for this" when the answer is "nowhere".
//
// StockReturn is all-or-nothing today, so netting and filtering would agree on every CURRENT input
// except the one above. Netting is still what belongs here: it is a statement about what the ref still
// holds, which stays true if a partial return ever lands, whereas a kind filter would need finding and
// changing at exactly the moment it started lying.
func (s *Service) StockPickLocations(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockPickLocationsRequest],
) (*connect.Response[inventoryv1.StockPickLocationsResponse], error) {
	var rows []pickLocationRow

	err := s.db.
		WithContext(ctx).
		Table("stock_movements AS m").
		Select("m.product_id AS product_id, m.rack_id AS rack_id, r.code AS rack_code, "+
			// A pick's delta is negative and a return's is positive, so negating and summing nets them:
			// what is still held for this ref. It also flips the sign for the screen — a picker is told
			// "take 3", never "take -3".
			"SUM(-m.delta) AS quantity").
		Joins("LEFT JOIN racks r ON r.id = m.rack_id").
		Where("m.warehouse_id = ? AND m.ref = ? AND m.kind IN ?",
			req.Msg.GetWarehouseId(),
			req.Msg.GetRef(),
			[]int32{
				int32(inventoryv1.MovementKind_MOVEMENT_KIND_PICK),
				int32(inventoryv1.MovementKind_MOVEMENT_KIND_RETURN),
			},
		).
		Group("m.product_id, m.rack_id, r.code").
		// Only what is still held. A shelf whose pick was fully returned nets to 0 and is not a stop.
		Having("SUM(-m.delta) > 0").
		// The same order StockPick drained in (#149): the UNPLACED pile first, then shelves by label. So
		// the list reads as the walk the system already planned rather than an arbitrary shuffle.
		//
		// `IS NOT NULL` rather than `IS NULL`: false sorts before true, so this puts the nulls — the
		// unplaced pile — first. The inverted form quietly sorted them last, and the test caught it.
		Order("m.product_id, (m.rack_id IS NOT NULL), r.code").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockPickLocation, 0, len(rows))

	for i := range rows {
		loc := inventoryv1.StockPickLocation{
			ProductId: rows[i].ProductID,
			Quantity:  rows[i].Quantity,
		}

		// nil rack = the unplaced pile (#135), carried over the wire as 0 with an empty code. It is a
		// real place, not a missing value, and the screen names it in words.
		if rows[i].RackID != nil {
			loc.RackId = *rows[i].RackID
		}

		if rows[i].RackCode != nil {
			loc.RackCode = *rows[i].RackCode
		}

		out = append(out, &loc)
	}

	return connect.NewResponse(&inventoryv1.StockPickLocationsResponse{Locations: out}), nil
}
