package liability_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
)

// The guideline list slice builders (guidelines/service-guideline.md). The POSITION / ENTRY slices
// reuse the LiabilityPosition / LiabilityLog messages directly. A position is keyed by
// counterparty_id (it has no id of its own); an entry by its id.

func positionOrderClause(sort *liabilityv1.LiabilityPositionListFilterSort) string {
	// Default: oldest debt first (the screen exists so somebody can chase the old ones). NULLS LAST
	// puts settled pairs after every outstanding one; id breaks ties for stable paging.
	if sort != nil {
		dir := "ASC"
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			dir = "DESC"
		}

		if s, ok := sort.GetS().(*liabilityv1.LiabilityPositionListFilterSort_Position); ok {
			switch s.Position {
			case liabilityv1.LiabilityPositionSort_LIABILITY_POSITION_SORT_BALANCE:
				return "balance " + dir + ", id ASC"
			case liabilityv1.LiabilityPositionSort_LIABILITY_POSITION_SORT_OLDEST_UNSETTLED:
				return "oldest_unsettled_at " + dir + " NULLS LAST, id ASC"
			}
		}
	}

	return "oldest_unsettled_at ASC NULLS LAST, id ASC"
}

// positionListItems wraps already-built positions (keyed by counterparty_id, in display order).
func positionListItems(
	positions []*liabilityv1.LiabilityPosition,
	types []liabilityv1.LiabilityPositionListDataType,
) ([]*liabilityv1.LiabilityPositionListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []liabilityv1.LiabilityPositionListDataType{
			liabilityv1.LiabilityPositionListDataType_LIABILITY_POSITION_LIST_DATA_TYPE_POSITION,
		}
	}

	ids := make([]uint64, 0, len(positions))
	for _, p := range positions {
		ids = append(ids, p.GetCounterpartyId())
	}

	items := make([]*liabilityv1.LiabilityPositionListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case liabilityv1.LiabilityPositionListDataType_LIABILITY_POSITION_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(positions))
			for _, p := range positions {
				m[p.GetCounterpartyId()] = &commonv1.GeneralItem{Id: p.GetCounterpartyId()}
			}
			items = append(items, &liabilityv1.LiabilityPositionListResponseItem{
				D: &liabilityv1.LiabilityPositionListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case liabilityv1.LiabilityPositionListDataType_LIABILITY_POSITION_LIST_DATA_TYPE_POSITION:
			m := make(map[uint64]*liabilityv1.LiabilityPosition, len(positions))
			for _, p := range positions {
				m[p.GetCounterpartyId()] = p
			}
			items = append(items, &liabilityv1.LiabilityPositionListResponseItem{
				D: &liabilityv1.LiabilityPositionListResponseItem_Position{Position: &liabilityv1.LiabilityPositionMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// entryListItems wraps already-built entries (keyed by id, in display order).
func entryListItems(
	entries []*liabilityv1.LiabilityLog,
	types []liabilityv1.LiabilityLogListDataType,
) ([]*liabilityv1.LiabilityLogListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []liabilityv1.LiabilityLogListDataType{
			liabilityv1.LiabilityLogListDataType_LIABILITY_LOG_LIST_DATA_TYPE_LOG,
		}
	}

	ids := make([]uint64, 0, len(entries))
	for _, e := range entries {
		ids = append(ids, e.GetId())
	}

	items := make([]*liabilityv1.LiabilityLogListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case liabilityv1.LiabilityLogListDataType_LIABILITY_LOG_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(entries))
			for _, e := range entries {
				m[e.GetId()] = &commonv1.GeneralItem{Id: e.GetId()}
			}
			items = append(items, &liabilityv1.LiabilityLogListResponseItem{
				D: &liabilityv1.LiabilityLogListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case liabilityv1.LiabilityLogListDataType_LIABILITY_LOG_LIST_DATA_TYPE_LOG:
			m := make(map[uint64]*liabilityv1.LiabilityLog, len(entries))
			for _, e := range entries {
				m[e.GetId()] = e
			}
			items = append(items, &liabilityv1.LiabilityLogListResponseItem{
				D: &liabilityv1.LiabilityLogListResponseItem_Log{Log: &liabilityv1.LiabilityLogMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// termsListItems wraps already-built terms, keyed by COUNTERPARTY_ID (0 = the creditor's default
// row), in display order.
//
// ⚠ The key is the counterparty, not the row's own id — `liability_terms.id` is a surrogate nothing
// else in the system names, while the whole screen is "what do I charge THIS team". Keying by id
// would make the caller do a second pass to find the row it came for.
func termsListItems(
	terms []*liabilityv1.LiabilityTerms,
	types []liabilityv1.LiabilityTermsListDataType,
) ([]*liabilityv1.LiabilityTermsListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []liabilityv1.LiabilityTermsListDataType{
			liabilityv1.LiabilityTermsListDataType_LIABILITY_TERMS_LIST_DATA_TYPE_TERMS,
		}
	}

	ids := make([]uint64, 0, len(terms))
	for _, t := range terms {
		ids = append(ids, t.GetCounterpartyId())
	}

	items := make([]*liabilityv1.LiabilityTermsListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case liabilityv1.LiabilityTermsListDataType_LIABILITY_TERMS_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(terms))
			for _, row := range terms {
				m[row.GetCounterpartyId()] = &commonv1.GeneralItem{Id: row.GetCounterpartyId()}
			}
			items = append(items, &liabilityv1.LiabilityTermsListResponseItem{
				D: &liabilityv1.LiabilityTermsListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case liabilityv1.LiabilityTermsListDataType_LIABILITY_TERMS_LIST_DATA_TYPE_TERMS:
			m := make(map[uint64]*liabilityv1.LiabilityTerms, len(terms))
			for _, row := range terms {
				m[row.GetCounterpartyId()] = row
			}
			items = append(items, &liabilityv1.LiabilityTermsListResponseItem{
				D: &liabilityv1.LiabilityTermsListResponseItem_Terms{Terms: &liabilityv1.LiabilityTermsMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// paymentListItems wraps already-built payments, keyed by id, in display order.
func paymentListItems(
	payments []*liabilityv1.LiabilityPayment,
	types []liabilityv1.LiabilityPaymentListDataType,
) ([]*liabilityv1.LiabilityPaymentListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []liabilityv1.LiabilityPaymentListDataType{
			liabilityv1.LiabilityPaymentListDataType_LIABILITY_PAYMENT_LIST_DATA_TYPE_PAYMENT,
		}
	}

	ids := make([]uint64, 0, len(payments))
	for _, p := range payments {
		ids = append(ids, p.GetId())
	}

	items := make([]*liabilityv1.LiabilityPaymentListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case liabilityv1.LiabilityPaymentListDataType_LIABILITY_PAYMENT_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(payments))
			for _, p := range payments {
				m[p.GetId()] = &commonv1.GeneralItem{Id: p.GetId()}
			}
			items = append(items, &liabilityv1.LiabilityPaymentListResponseItem{
				D: &liabilityv1.LiabilityPaymentListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case liabilityv1.LiabilityPaymentListDataType_LIABILITY_PAYMENT_LIST_DATA_TYPE_PAYMENT:
			m := make(map[uint64]*liabilityv1.LiabilityPayment, len(payments))
			for _, p := range payments {
				m[p.GetId()] = p
			}
			items = append(items, &liabilityv1.LiabilityPaymentListResponseItem{
				D: &liabilityv1.LiabilityPaymentListResponseItem_Payment{Payment: &liabilityv1.LiabilityPaymentMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}
