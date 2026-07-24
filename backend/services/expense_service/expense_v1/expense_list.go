package expense_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

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
		// By the date the cost BELONGS TO, not when it was typed. Somebody entering last month's
		// payroll today expects it to sort with last month, and id breaks the tie so two costs on one
		// day have a stable order.
		Order("occurred_at DESC, id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	out := make([]*expensev1.ExpenseRecord, 0, len(rows))
	for i := range rows {
		out = append(out, costToProto(&rows[i]))
	}

	totals, err := s.totals(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&expensev1.ExpenseListResponse{
		Expenses:    out,
		PageInfo: pageInfo(page, total),
		Totals:   totals,
	}), nil
}

// filtered builds the WHERE every read here shares.
//
// One place, because the LIST and the TOTALS must agree about what the period contains. Two copies of
// a date range is how a total starts describing a different set of rows than the table under it.
func (s *Service) filtered(ctx context.Context, msg *expensev1.ExpenseListRequest) (*gorm.DB, error) {
	query := s.db.
		WithContext(ctx).
		Model(&expense_service_models.ExpenseRecord{}).
		// EVERY row, voided ones INCLUDED. The `voided_at IS NULL` predicate belongs to the TOTALS
		// alone (see totals below), and keeping it out of here is the whole point of voiding rather
		// than deleting: the list shows the retraction, the totals ignore it.
		//
		// It lived here first, and the comment beside it claimed voided rows were "still visible on the
		// row list" while the code hid them — the same contradiction #164 shipped and had to correct in
		// revenue. Hiding a voided row makes it exactly as invisible as deleting it, which is the
		// option the owner did not choose.
		Where("team_id = ?", msg.GetTeamId())

	// THE PERIOD, inclusive at both ends. Server-side, because the list is paginated: a client-side
	// date filter narrows the loaded page only and leaves the totals beside it unfiltered.
	if raw := msg.GetFrom(); raw != "" {
		from, err := parseDate(raw)
		if err != nil {
			return nil, costErr(err)
		}

		query = query.Where("occurred_at >= ?", from)
	}

	if raw := msg.GetTo(); raw != "" {
		to, err := parseDate(raw)
		if err != nil {
			return nil, costErr(err)
		}

		// `occurred_at` is a DATE, so an inclusive upper bound needs no end-of-day arithmetic — the
		// comparison is date to date.
		query = query.Where("occurred_at <= ?", to)
	}

	if kind := msg.GetKind(); kind != expensev1.ExpenseKind_EXPENSE_KIND_UNSPECIFIED {
		query = query.Where("kind = ?", int32(kind))
	}

	if shop := msg.GetShopId(); shop != 0 {
		query = query.Where("shop_id = ?", shop)
	}

	return query, nil
}

type kindTotalRow struct {
	Kind  int32
	Total int64
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
		// LIVE rows only — and this is the ONLY place that predicate belongs. A voided cost was
		// entered by mistake and earned its retraction, so it never counts; the list above still shows
		// it, struck through, because an entry that was made and then withdrawn is exactly what
		// somebody looking at a changed total wants to see.
		Where("voided_at IS NULL").
		Select("kind, COALESCE(SUM(amount), 0) AS total").
		Group("kind").
		Scan(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	out := expensev1.ExpenseTotals{ByKind: make(map[int32]int64, len(rows))}

	for _, r := range rows {
		out.ByKind[r.Kind] = r.Total
		out.Total += r.Total
	}

	// A kind with nothing in the period is ABSENT rather than 0. Absent and zero read identically on a
	// summary card, and building the empty ones would mean this handler knowing the enum's members —
	// which would then need editing every time a kind is added.
	return &out, nil
}
