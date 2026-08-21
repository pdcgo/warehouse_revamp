package settlement_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
)

// The guideline list slice builders (guidelines/service-guideline.md). The POSITION / ENTRY slices
// reuse the SettlementPosition / SettlementEntry messages directly. A position is keyed by
// counterparty_id (it has no id of its own); an entry by its id.

func positionOrderClause(sort *settlementv1.SettlementPositionListFilterSort) string {
	// Default: oldest debt first (the screen exists so somebody can chase the old ones). NULLS LAST
	// puts settled pairs after every outstanding one; id breaks ties for stable paging.
	if sort != nil {
		dir := "ASC"
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			dir = "DESC"
		}

		if s, ok := sort.GetS().(*settlementv1.SettlementPositionListFilterSort_Position); ok {
			switch s.Position {
			case settlementv1.SettlementPositionSort_SETTLEMENT_POSITION_SORT_BALANCE:
				return "balance " + dir + ", id ASC"
			case settlementv1.SettlementPositionSort_SETTLEMENT_POSITION_SORT_OLDEST_UNSETTLED:
				return "oldest_unsettled_at " + dir + " NULLS LAST, id ASC"
			}
		}
	}

	return "oldest_unsettled_at ASC NULLS LAST, id ASC"
}

// positionListItems wraps already-built positions (keyed by counterparty_id, in display order).
func positionListItems(
	positions []*settlementv1.SettlementPosition,
	types []settlementv1.SettlementPositionListDataType,
) ([]*settlementv1.SettlementPositionListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []settlementv1.SettlementPositionListDataType{
			settlementv1.SettlementPositionListDataType_SETTLEMENT_POSITION_LIST_DATA_TYPE_POSITION,
		}
	}

	ids := make([]uint64, 0, len(positions))
	for _, p := range positions {
		ids = append(ids, p.GetCounterpartyId())
	}

	items := make([]*settlementv1.SettlementPositionListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case settlementv1.SettlementPositionListDataType_SETTLEMENT_POSITION_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(positions))
			for _, p := range positions {
				m[p.GetCounterpartyId()] = &commonv1.GeneralItem{Id: p.GetCounterpartyId()}
			}
			items = append(items, &settlementv1.SettlementPositionListResponseItem{
				D: &settlementv1.SettlementPositionListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case settlementv1.SettlementPositionListDataType_SETTLEMENT_POSITION_LIST_DATA_TYPE_POSITION:
			m := make(map[uint64]*settlementv1.SettlementPosition, len(positions))
			for _, p := range positions {
				m[p.GetCounterpartyId()] = p
			}
			items = append(items, &settlementv1.SettlementPositionListResponseItem{
				D: &settlementv1.SettlementPositionListResponseItem_Position{Position: &settlementv1.SettlementPositionMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// entryListItems wraps already-built entries (keyed by id, in display order).
func entryListItems(
	entries []*settlementv1.SettlementEntry,
	types []settlementv1.SettlementEntryListDataType,
) ([]*settlementv1.SettlementEntryListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []settlementv1.SettlementEntryListDataType{
			settlementv1.SettlementEntryListDataType_SETTLEMENT_ENTRY_LIST_DATA_TYPE_ENTRY,
		}
	}

	ids := make([]uint64, 0, len(entries))
	for _, e := range entries {
		ids = append(ids, e.GetId())
	}

	items := make([]*settlementv1.SettlementEntryListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case settlementv1.SettlementEntryListDataType_SETTLEMENT_ENTRY_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(entries))
			for _, e := range entries {
				m[e.GetId()] = &commonv1.GeneralItem{Id: e.GetId()}
			}
			items = append(items, &settlementv1.SettlementEntryListResponseItem{
				D: &settlementv1.SettlementEntryListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case settlementv1.SettlementEntryListDataType_SETTLEMENT_ENTRY_LIST_DATA_TYPE_ENTRY:
			m := make(map[uint64]*settlementv1.SettlementEntry, len(entries))
			for _, e := range entries {
				m[e.GetId()] = e
			}
			items = append(items, &settlementv1.SettlementEntryListResponseItem{
				D: &settlementv1.SettlementEntryListResponseItem_Entry{Entry: &settlementv1.SettlementEntryMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// termsListItems wraps already-built terms, keyed by COUNTERPARTY_ID (0 = the creditor's default
// row), in display order.
//
// ⚠ The key is the counterparty, not the row's own id — `settlement_terms.id` is a surrogate nothing
// else in the system names, while the whole screen is "what do I charge THIS team". Keying by id
// would make the caller do a second pass to find the row it came for.
func termsListItems(
	terms []*settlementv1.SettlementTerms,
	types []settlementv1.SettlementTermsListDataType,
) ([]*settlementv1.SettlementTermsListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []settlementv1.SettlementTermsListDataType{
			settlementv1.SettlementTermsListDataType_SETTLEMENT_TERMS_LIST_DATA_TYPE_TERMS,
		}
	}

	ids := make([]uint64, 0, len(terms))
	for _, t := range terms {
		ids = append(ids, t.GetCounterpartyId())
	}

	items := make([]*settlementv1.SettlementTermsListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case settlementv1.SettlementTermsListDataType_SETTLEMENT_TERMS_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(terms))
			for _, row := range terms {
				m[row.GetCounterpartyId()] = &commonv1.GeneralItem{Id: row.GetCounterpartyId()}
			}
			items = append(items, &settlementv1.SettlementTermsListResponseItem{
				D: &settlementv1.SettlementTermsListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case settlementv1.SettlementTermsListDataType_SETTLEMENT_TERMS_LIST_DATA_TYPE_TERMS:
			m := make(map[uint64]*settlementv1.SettlementTerms, len(terms))
			for _, row := range terms {
				m[row.GetCounterpartyId()] = row
			}
			items = append(items, &settlementv1.SettlementTermsListResponseItem{
				D: &settlementv1.SettlementTermsListResponseItem_Terms{Terms: &settlementv1.SettlementTermsMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// paymentListItems wraps already-built payments, keyed by id, in display order.
func paymentListItems(
	payments []*settlementv1.SettlementPayment,
	types []settlementv1.SettlementPaymentListDataType,
) ([]*settlementv1.SettlementPaymentListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []settlementv1.SettlementPaymentListDataType{
			settlementv1.SettlementPaymentListDataType_SETTLEMENT_PAYMENT_LIST_DATA_TYPE_PAYMENT,
		}
	}

	ids := make([]uint64, 0, len(payments))
	for _, p := range payments {
		ids = append(ids, p.GetId())
	}

	items := make([]*settlementv1.SettlementPaymentListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case settlementv1.SettlementPaymentListDataType_SETTLEMENT_PAYMENT_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(payments))
			for _, p := range payments {
				m[p.GetId()] = &commonv1.GeneralItem{Id: p.GetId()}
			}
			items = append(items, &settlementv1.SettlementPaymentListResponseItem{
				D: &settlementv1.SettlementPaymentListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case settlementv1.SettlementPaymentListDataType_SETTLEMENT_PAYMENT_LIST_DATA_TYPE_PAYMENT:
			m := make(map[uint64]*settlementv1.SettlementPayment, len(payments))
			for _, p := range payments {
				m[p.GetId()] = p
			}
			items = append(items, &settlementv1.SettlementPaymentListResponseItem{
				D: &settlementv1.SettlementPaymentListResponseItem_Payment{Payment: &settlementv1.SettlementPaymentMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}
