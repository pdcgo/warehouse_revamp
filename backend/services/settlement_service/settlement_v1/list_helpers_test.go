package settlement_v1_test

import (
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
)

// Test helpers reading the guideline list shapes back into flat slices, in each response's sorted id
// order. A position is keyed by counterparty_id; an entry by its id.

func positionRows(res *settlementv1.SettlementPositionListResponse) []*settlementv1.SettlementPosition {
	var m map[uint64]*settlementv1.SettlementPosition
	for _, it := range res.GetItems() {
		p := it.GetPosition()
		if p != nil {
			m = p.GetMapData()
		}
	}

	out := make([]*settlementv1.SettlementPosition, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

func entryRows(res *settlementv1.SettlementEntryListResponse) []*settlementv1.SettlementEntry {
	var m map[uint64]*settlementv1.SettlementEntry
	for _, it := range res.GetItems() {
		e := it.GetEntry()
		if e != nil {
			m = e.GetMapData()
		}
	}

	out := make([]*settlementv1.SettlementEntry, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := m[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}
