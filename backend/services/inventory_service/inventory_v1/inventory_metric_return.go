package inventory_v1

import (
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"
)

// RETURNED STOCK — `metrics/inventory/return` (the-inventory-metrics-prototype-is-accepted, return_decision.md): an
// order's return accepted at the return warehouse, on the accept's Jakarta day — the sound units back on the shelf at
// what the order took them at (a-return-mints-one-batch-per-batch-the-order-took; the markup paid on a borrowed line),
// and the door's broken (thrown away) and missing. The seller is the ORDERING team, a borrowed line under its mapped own
// product (a-returned-borrowed-unit-is-relabelled-at-the-accept); the supplier the layer's batch's. Read from the
// accept's `return` change rows and its `return` door rows, both written in the accept's own transaction. A warehouse
// reads the units and the door, never the value.

var returnFields = []protoreflect.Name{"back_count", "back_value", "broken_count", "missing_count"}

func readReturn(db *gorm.DB, q stockQuery) (map[string]figures, error) {
	src, args := doorMovementSource("return", "back_count", "back_value", q)

	return readMovement(db, q, src, args, returnFields)
}
