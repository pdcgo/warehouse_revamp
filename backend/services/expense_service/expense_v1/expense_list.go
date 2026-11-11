package expense_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseList returns a team's costs for a PERIOD, newest first, with per-kind totals (#168).
//
// The team_id clause IS the scope check — one team can never read another's costs by id, which
// matters more here than on most lists: this is the money.
func (s *Service) ExpenseList(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseListRequest],
) (*connect.Response[expensev1.ExpenseListResponse], error) {
	page := req.Msg.GetPage()

	filtered, err := s.filtered(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	var total int64

	err = filtered.Count(&total).Error
	if err != nil {
		return nil, costErr(err)
	}

	var rows []expense_service_models.ExpenseRecord

	err = filtered.
		Order(expenseOrderClause(req.Msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	// Each expense on the page says what it counts for after its adjustments — wherever they sit in the list, on this
	// page or another — so Batalkan knows the whole of what is left.
	expenseIDs := make([]uint64, 0, len(rows))
	for i := range rows {
		if rows[i].AdjustsExpenseID == 0 {
			expenseIDs = append(expenseIDs, rows[i].ID)
		}
	}

	adjusted, err := adjustedSums(s.db.WithContext(ctx), expenseIDs)
	if err != nil {
		return nil, costErr(err)
	}

	items, ids := expenseListItems(rows, adjusted, req.Msg.GetDataRequest())

	totals, err := s.totals(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&expensev1.ExpenseListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
		Totals:   totals,
	}), nil
}

// expenseOrderClause maps a ListFilterSort to a safe "column DIR, id DESC" ORDER BY (columns are a
// fixed whitelist). Default is by the date the cost BELONGS TO, newest first — somebody entering last
// month's payroll today expects it to sort with last month, and id breaks the tie for a stable order.
func expenseOrderClause(sort *expensev1.ExpenseListFilterSort) string {
	col := "occurred_at"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *expensev1.ExpenseListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "note"
			}
		case *expensev1.ExpenseListFilterSort_Expense:
			switch s.Expense {
			case expensev1.ExpenseRowSort_EXPENSE_ROW_SORT_OCCURRED_AT:
				col = "occurred_at"
			case expensev1.ExpenseRowSort_EXPENSE_ROW_SORT_AMOUNT:
				col = "amount"
			case expensev1.ExpenseRowSort_EXPENSE_ROW_SORT_CREATED_AT:
				col = "created_at"
			}
		}
	}

	return col + " " + dir + ", id DESC"
}

// expenseRowItem is the EXPENSE (row) slice for one record — an expense with its net, or an adjustment.
func expenseRowItem(c *expense_service_models.ExpenseRecord, adjusted map[uint64]float64) *expensev1.ExpenseRowItem {
	var net float64
	if c.AdjustsExpenseID == 0 {
		net = c.Amount + adjusted[c.ID]
	}

	return &expensev1.ExpenseRowItem{
		Id:               c.ID,
		TeamId:           c.TeamID,
		ShopId:           c.ShopID,
		Kind:             expensev1.ExpenseKind(c.Kind),
		Amount:           c.Amount,
		OccurredAt:       c.OccurredAt.Format(dateLayout),
		Note:             c.Note,
		CreatedBy:        c.CreatedBy,
		CreatedAtUnix:    c.CreatedAt.Unix(),
		AdjustsExpenseId: c.AdjustsExpenseID,
		NetAmount:        net,
		FinanceAccountId: c.FinanceAccountID,
		// The "by Root team" badge beside who recorded it (an-override-shows-a-platform-badge).
		IsOverride: c.IsOverride,
	}
}

// expenseListItems builds the response slices for the requested data types (defaulting to the EXPENSE
// row slice) plus the sorted id list, from rows already in display order.
func expenseListItems(
	rows []expense_service_models.ExpenseRecord,
	adjusted map[uint64]float64,
	types []expensev1.ExpenseListDataType,
) ([]*expensev1.ExpenseListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []expensev1.ExpenseListDataType{expensev1.ExpenseListDataType_EXPENSE_LIST_DATA_TYPE_EXPENSE}
	}

	ids := make([]uint64, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].ID)
	}

	items := make([]*expensev1.ExpenseListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case expensev1.ExpenseListDataType_EXPENSE_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(rows))
			for i := range rows {
				m[rows[i].ID] = &commonv1.GeneralItem{Id: rows[i].ID, Name: rows[i].Note}
			}
			items = append(items, &expensev1.ExpenseListResponseItem{
				D: &expensev1.ExpenseListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case expensev1.ExpenseListDataType_EXPENSE_LIST_DATA_TYPE_EXPENSE:
			m := make(map[uint64]*expensev1.ExpenseRowItem, len(rows))
			for i := range rows {
				m[rows[i].ID] = expenseRowItem(&rows[i], adjusted)
			}
			items = append(items, &expensev1.ExpenseListResponseItem{
				D: &expensev1.ExpenseListResponseItem_Expense{Expense: &expensev1.ExpenseRowMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}

// filtered builds the WHERE every read here shares.
//
// One place, because the LIST and the TOTALS must agree about what the period contains. Two copies of
// a date range is how a total starts describing a different set of rows than the table under it.
func (s *Service) filtered(ctx context.Context, msg *expensev1.ExpenseListRequest) (*gorm.DB, error) {
	query := s.db.
		WithContext(ctx).
		Model(&expense_service_models.ExpenseRecord{}).
		// EVERY row — the expenses AND the adjustments that correct them. An adjustment carries its expense's day,
		// kind and shop, so a period, a kind or a shop takes the correction wherever it takes the mistake, and the
		// month's list shows the two together (an-adjustment-counts-on-the-day-it-fixes).
		Where("team_id = ?", msg.GetTeamId())

	filter := msg.GetFilter()

	// THE PERIOD, inclusive at both ends. Server-side, because the list is paginated: a client-side
	// date filter narrows the loaded page only and leaves the totals beside it unfiltered.
	if raw := filter.GetFrom(); raw != "" {
		from, err := parseDate(raw)
		if err != nil {
			return nil, costErr(err)
		}

		query = query.Where("occurred_at >= ?", from)
	}

	if raw := filter.GetTo(); raw != "" {
		to, err := parseDate(raw)
		if err != nil {
			return nil, costErr(err)
		}

		// `occurred_at` is a DATE, so an inclusive upper bound needs no end-of-day arithmetic — the
		// comparison is date to date.
		query = query.Where("occurred_at <= ?", to)
	}

	if kind := filter.GetKind(); kind != expensev1.ExpenseKind_EXPENSE_KIND_UNSPECIFIED {
		query = query.Where("kind = ?", int32(kind))
	}

	if shop := filter.GetShopId(); shop != 0 {
		query = query.Where("shop_id = ?", shop)
	}

	return query, nil
}

type kindTotalRow struct {
	Kind  int32
	Total float64
}

// totals sums the WHOLE filtered period, never the page.
//
// A page total is a different number wearing the same label: it changes when somebody picks a
// different page size, and it is wrong in a way the reader cannot see. Same split RevenueTotals uses
// (#78), and the same test to prove it — ask for a page smaller than the data.
func (s *Service) totals(ctx context.Context, msg *expensev1.ExpenseListRequest) (*expensev1.ExpenseTotals, error) {
	query, err := s.filtered(ctx, msg)
	if err != nil {
		return nil, err
	}

	var rows []kindTotalRow

	err = query.
		// Every row counts: an adjustment's signed amount IS the correction, so the sum is the corrected figure, and the
		// list above shows each row it is made of.
		Select("kind, COALESCE(SUM(amount), 0) AS total").
		Group("kind").
		Scan(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	out := expensev1.ExpenseTotals{ByKind: make(map[int32]float64, len(rows))}

	for _, r := range rows {
		out.ByKind[r.Kind] = r.Total
		out.Total += r.Total
	}

	// A kind with nothing in the period is ABSENT rather than 0. Absent and zero read identically on a
	// summary card, and building the empty ones would mean this handler knowing the enum's members —
	// which would then need editing every time a kind is added.
	return &out, nil
}
