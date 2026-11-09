package inventory_v1

import (
	"errors"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
)

// countedRefusal maps a write refused by a stock count's lock (a-lock-stops-sales-and-cancels-too,
// a-rack-a-count-holds-cannot-be-deleted) to Connect: FailedPrecondition, with the message naming the count, who started
// it and when (an-abandoned-count-waits-for-the-admin). nil when the error is something else. Every handler that moves
// units checks it first.
func countedRefusal(err error) *connect.Error {
	var lines *inventory_mutations.CountedLinesError
	if errors.As(err, &lines) {
		return connect.NewError(connect.CodeFailedPrecondition, lines)
	}

	var rack *inventory_ledgers.RackCountedError
	if errors.As(err, &rack) {
		return connect.NewError(connect.CodeFailedPrecondition, rack)
	}

	var counted *inventory_ledgers.CountedError
	if !errors.As(err, &counted) {
		return nil
	}

	return connect.NewError(connect.CodeFailedPrecondition, counted)
}

// isCounting is whether a stock count holds the product on the rack, from a CountLocks read.
func isCounting(locks map[inventory_ledgers.RackKey]inventory_ledgers.CountLock, productID, placementID uint64) bool {
	_, held := locks[inventory_ledgers.RackKey{ProductID: productID, PlacementID: placementID}]

	return held
}
