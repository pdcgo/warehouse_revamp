package liability_v1_test

import (
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
)

// Test helpers reading the guideline list shapes back into flat slices, in each response's sorted id
// order. A position is keyed by counterparty_id; an entry by its id.

func positionRows(res *liabilityv1.LiabilityPositionListResponse) []*liabilityv1.LiabilityPosition {
	var m map[uint64]*liabilityv1.LiabilityPosition
	for _, it := range res.GetItems() {
		p := it.GetPosition()
		if p != nil {
			m = p.GetMapData()
		}
	}

	out := make([]*liabilityv1.LiabilityPosition, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func entryRows(res *liabilityv1.LiabilityLogListResponse) []*liabilityv1.LiabilityLog {
	var m map[uint64]*liabilityv1.LiabilityLog
	for _, it := range res.GetItems() {
		e := it.GetLog()
		if e != nil {
			m = e.GetMapData()
		}
	}

	out := make([]*liabilityv1.LiabilityLog, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}
